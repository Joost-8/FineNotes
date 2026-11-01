import { describe, expect, it } from "vitest";
import { decodeAppleLz4, decodeBlock, isAppleLz4, Lz4Error } from "../../src/import/apple-lz4";
import {
  isBinaryPlist,
  isDict,
  parseBinaryPlist,
  PlistError,
  PlistUid,
  unarchive,
} from "../../src/import/bplist";
import {
  Message,
  parseMessage,
  ProtobufError,
  readVarint,
  splitDelimited,
} from "../../src/import/protobuf";
import { bplist, bv4Block, bv4Raw, delimited, pb, Uid, varint } from "./builders";

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array): string => new TextDecoder().decode(b);

describe("Apple LZ4 frames", () => {
  it("passes stored blocks through", () => {
    const frame = bv4Raw(bytes("hello"));
    expect(isAppleLz4(frame)).toBe(true);
    expect(text(decodeAppleLz4(frame))).toBe("hello");
  });

  it("expands literals and overlapping matches", () => {
    // "abc" as literals, then a 9-byte match at offset 3: "abcabcabcabc".
    const block = [0x35, ...bytes("abc"), 3, 0];
    expect(text(decodeAppleLz4(bv4Block(block, 12)))).toBe("abcabcabcabc");
  });

  it("reads extended literal and match lengths", () => {
    const literals = "x".repeat(20);
    // 15 + 5 literals, then a match of 15 + 4 + 2 = 21 bytes at offset 1.
    const block = [0xff, 5, ...bytes(literals), 1, 0, 2];
    expect(text(decodeBlock(new Uint8Array(block), 41))).toBe("x".repeat(41));
  });

  it("joins several blocks", () => {
    const a = bv4Raw(bytes("ab"));
    const b = bv4Raw(bytes("cd"));
    const joined = new Uint8Array([...a.subarray(0, a.length - 4), ...b]);
    expect(text(decodeAppleLz4(joined))).toBe("abcd");
  });

  it("lets a block's matches reach back into the blocks before it", () => {
    const a = bv4Block([0x30, ...bytes("abc")], 3);
    // No literals, then a 9-byte match 3 back: in the first block.
    const b = bv4Block([0x05, 3, 0], 9);
    const joined = new Uint8Array([...a.subarray(0, a.length - 4), ...b]);
    expect(text(decodeAppleLz4(joined))).toBe("abc".repeat(4));
  });

  it("refuses malformed frames", () => {
    expect(isAppleLz4(new Uint8Array([1, 2]))).toBe(false);
    expect(isAppleLz4(bytes("nope"))).toBe(false);
    expect(() => decodeAppleLz4(bytes("nope1234"))).toThrow(Lz4Error);
    expect(() => decodeAppleLz4(bytes("bv4-"))).toThrow(Lz4Error);
    expect(() => decodeAppleLz4(bv4Raw(bytes("ab")).subarray(0, 10))).toThrow(Lz4Error);
    expect(() => decodeAppleLz4(bytes("bv41\x05\0\0\0"))).toThrow(Lz4Error);
    expect(() => decodeAppleLz4(bv4Block([0x10, 0x61], 1).subarray(0, 14))).toThrow(Lz4Error);
    expect(() => decodeAppleLz4(new Uint8Array([...bytes("bv4-"), 9, 0, 0, 0, 1]))).toThrow(
      Lz4Error,
    );
    // Match before any output, a match past the end, too little output.
    expect(() => decodeBlock(new Uint8Array([0x00, 1, 0]), 4)).toThrow(Lz4Error);
    expect(() => decodeBlock(new Uint8Array([0x1f, 0x61, 1, 0]), 3)).toThrow(Lz4Error);
    expect(() => decodeBlock(new Uint8Array([0x10, 0x61]), 3)).toThrow(Lz4Error);
    expect(() => decodeBlock(new Uint8Array([0x20, 0x61]), 3)).toThrow(Lz4Error);
    expect(() => decodeBlock(new Uint8Array([0xf0]), 20)).toThrow(Lz4Error);
    expect(() => decodeBlock(new Uint8Array([0x10, 0x61, 1]), 5)).toThrow(Lz4Error);
  });
});

describe("protobuf reader", () => {
  it("reads every wire type", () => {
    const m = Message.parse(
      pb([
        [1, { str: "id" }],
        [2, { int: 300 }],
        [3, { f32: 1.5 }],
        [4, { f64: 2.25 }],
        [5, { msg: [[1, { str: "inner" }]] }],
      ]),
    );
    expect(m.string(1)).toBe("id");
    expect(m.int(2)).toBe(300);
    expect(m.float(3)).toBe(1.5);
    expect(m.double(4)).toBe(2.25);
    expect(m.message(5)?.string(1)).toBe("inner");
    expect(m.has(2)).toBe(true);
    expect(m.has(9)).toBe(false);
    expect(m.int(9) ?? m.float(9) ?? m.double(9) ?? m.bytes(9) ?? m.message(9)).toBeUndefined();
  });

  it("gives no message for bytes that are not one", () => {
    const m = Message.parse(pb([[1, { bytes: new Uint8Array([0xff]) }]]));
    expect(m.message(1)).toBeUndefined();
  });

  it("splits length-delimited streams", () => {
    const parts = splitDelimited(delimited([pb([[1, { int: 1 }]]), new Uint8Array(200)]));
    expect(parts.map((p) => p.length)).toEqual([2, 200]);
    expect(() => splitDelimited(new Uint8Array([5, 1]))).toThrow(ProtobufError);
  });

  it("reads large varints", () => {
    expect(readVarint(new Uint8Array(varint(2n ** 60n)), 0)[0]).toBe(2n ** 60n);
  });

  it("refuses malformed messages", () => {
    expect(() => parseMessage(new Uint8Array([0x80]))).toThrow(ProtobufError);
    expect(() => parseMessage(new Uint8Array(11).fill(0xff))).toThrow(ProtobufError);
    expect(() => parseMessage(new Uint8Array([0x00, 1]))).toThrow(ProtobufError);
    expect(() => parseMessage(new Uint8Array([0x0b]))).toThrow(ProtobufError);
    expect(() => parseMessage(new Uint8Array([0x0a, 5, 1]))).toThrow(ProtobufError);
    expect(() => parseMessage(new Uint8Array([0x0d, 1]))).toThrow(ProtobufError);
  });
});

describe("binary plists", () => {
  it("decodes every object type", () => {
    const when = new Date(Date.UTC(2026, 9, 12));
    const v = parseBinaryPlist(
      bplist({
        nothing: null,
        yes: true,
        no: false,
        small: 7,
        mid: 4000,
        big: { int64: 2n ** 40n },
        huge: { int64: 2n ** 62n },
        float: { real: 1.5 },
        double: 2.25,
        when,
        data: new Uint8Array([1, 2]),
        ascii: "hello",
        long: "x".repeat(20),
        wide: { utf16: "título" },
        uid: new Uid(3),
        list: [1, "two"],
      }),
    );
    expect(isDict(v)).toBe(true);
    if (!isDict(v)) return;
    expect(v.nothing).toBeNull();
    expect([v.yes, v.no, v.small, v.mid, v.big, v.float, v.double]).toEqual([
      true,
      false,
      7,
      4000,
      2 ** 40,
      1.5,
      2.25,
    ]);
    expect(v.huge).toBe(2n ** 62n);
    expect(v.when).toEqual(when);
    expect(v.data).toEqual(new Uint8Array([1, 2]));
    expect([v.ascii, v.long, v.wide]).toEqual(["hello", "x".repeat(20), "título"]);
    expect(v.uid).toEqual(new PlistUid(3));
    expect(v.list).toEqual([1, "two"]);
  });

  it("refuses what is not a binary plist", () => {
    expect(isBinaryPlist(bytes("<?xml"))).toBe(false);
    expect(() => parseBinaryPlist(bytes("bplist00"))).toThrow(PlistError);
    const good = bplist({ a: 1 });
    const badTrailer = good.slice();
    badTrailer[badTrailer.length - 9] = 200; // top object out of range
    expect(() => parseBinaryPlist(badTrailer)).toThrow(PlistError);
    const badMarker = good.slice();
    badMarker[8] = 0x70; // unknown type
    expect(() => parseBinaryPlist(badMarker)).toThrow(PlistError);
  });

  it("resolves keyed archives", () => {
    const archive = bplist({
      $archiver: "NSKeyedArchiver",
      $top: { root: new Uid(1) },
      $objects: [
        "$null",
        {
          name: new Uid(2),
          items: new Uid(3),
          meta: new Uid(4),
          empty: new Uid(5),
          when: new Uid(6),
          self: new Uid(1),
          none: new Uid(0),
          $class: new Uid(7),
        },
        { "NS.string": "Biology", $class: new Uid(8) },
        { "NS.objects": [new Uid(2), 5], $class: new Uid(9) },
        { "NS.keys": [new Uid(10)], "NS.objects": [new Uid(2)], $class: new Uid(11) },
        { $class: new Uid(12) },
        { "NS.time": 0, $class: new Uid(13) },
        { $classes: ["Session", "NSObject"] },
        { $classes: ["NSMutableString"] },
        { $classes: ["NSArray"] },
        "title",
        { $classes: ["NSDictionary"] },
        { $classes: ["NSMutableSet"] },
        { $classes: ["NSDate"] },
      ],
    });
    const tree = unarchive(parseBinaryPlist(archive));
    expect(isDict(tree) && isDict(tree.root)).toBe(true);
    if (!isDict(tree) || !isDict(tree.root)) return;
    const root = tree.root;
    expect(root.$class).toBe("Session");
    expect(root.name).toBe("Biology");
    expect(root.items).toEqual(["Biology", 5]);
    expect(root.meta).toEqual({ title: "Biology" });
    expect(root.empty).toEqual([]);
    expect(root.when).toEqual(new Date(Date.UTC(2001, 0, 1)));
    expect(root.self).toBeInstanceOf(PlistUid);
    expect(root.none).toBeNull();
  });

  it("reads the older NS.key.<i> dictionaries and NSData", () => {
    const archive = bplist({
      $top: { root: new Uid(1) },
      $objects: [
        "$null",
        { "NS.key.0": new Uid(2), "NS.object.0": new Uid(3), $class: new Uid(4) },
        "stringKey",
        { "NS.data": new Uint8Array([9]), $class: new Uid(5) },
        { $classes: ["NSMutableDictionary"] },
        { $classes: ["NSMutableData"] },
      ],
    });
    const tree = unarchive(parseBinaryPlist(archive));
    expect(isDict(tree) && tree.root).toEqual({ stringKey: new Uint8Array([9]) });
  });

  it("refuses a plist that is not an archive", () => {
    expect(() => unarchive([1, 2])).toThrow(PlistError);
  });
});
