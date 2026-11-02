/**
 * Fonts FineNotes can fetch for a text box whose family this device lacks
 * (an imported Notability or Goodnotes notebook, a box typed on an iPad and
 * opened on Windows). **Pure:** names, files and URLs; the view downloads,
 * checks and loads them (`view/font-store.ts`).
 *
 * Only fonts under an open licence (SIL OFL, Apache) are here: they may be
 * passed on with software as long as their licence goes with them, so each
 * download writes the licence file beside the font. Apple's own fonts
 * (Chalkboard SE, Helvetica Neue, American Typewriter...) may not be: their
 * licence ties them to Apple hardware and forbids redistributing them. For
 * those the catalogue names a stand-in (`STAND_INS`), an open font scaled with
 * `size-adjust` to the same average width, so the text wraps nearly where it
 * did. The shapes stay the stand-in's own.
 *
 * Files come from the google/fonts repository at a pinned commit, each
 * checked against its SHA-256 before it is written, and never altered: the
 * OFL counts a re-encoded or subset font as a modified version.
 */

import { formatSize } from "../downloads/model-manifest";
import { ASSETS_FOLDER } from "./vault-folders";
import { cleanFamily } from "./text-family";

/** The vault folder fetched fonts and their licences are kept in. */
export const FONT_FOLDER = `${ASSETS_FOLDER}/Fonts`;

/** The google/fonts commit every file is fetched from (2026-10-30). */
export const FONT_COMMIT = "6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec";

/** One file of a font, as published. */
export interface FontFile {
  name: string;
  bytes: number;
  sha256: string;
}

/** A font file and the face it is: `weight` is one weight or a variable font's range. */
export interface FontFaceFile extends FontFile {
  weight: string;
  style: "normal" | "italic";
}

export interface CatalogueFont {
  /** The family, as a text box names it. */
  family: string;
  /** Its folder in google/fonts (`ofl/caveat`). */
  dir: string;
  licence: FontFile;
  /** Regular, bold and italic only: the weights and styles a text box uses. */
  files: FontFaceFile[];
}

/**
 * Families a stand-in is offered for, lower-cased, with the scale that gives
 * the stand-in the family's average letter width (`size-adjust`). Chalkboard
 * SE is Notability's default; Comic Relief has the letter widths of Comic Sans
 * MS, whose shapes Chalkboard SE's follow. Its scale stays 1 (Comic Sans'
 * widths) until Chalkboard SE is measured on an Apple device: no open metric
 * set has it.
 */
export const STAND_INS: Readonly<Record<string, { family: string; sizeAdjust: number }>> = {
  "chalkboard se": { family: "Comic Relief", sizeAdjust: 1 },
};

export const FONT_CATALOGUE: readonly CatalogueFont[] = [
  {
    family: "Architects Daughter",
    dir: "ofl/architectsdaughter",
    licence: {
      name: "OFL.txt",
      bytes: 4362,
      sha256: "0e441ae9f18ad0c294cc5b6ae3974c2db1614cab220598578b1b58c4cc334485",
    },
    files: [
      {
        name: "ArchitectsDaughter-Regular.ttf",
        bytes: 43352,
        sha256: "6159718a08898e34bc1cb7354086141a5f9a70b73e54dbec27ead0d59a697359",
        weight: "400",
        style: "normal",
      },
    ],
  },
  {
    family: "Caveat",
    dir: "ofl/caveat",
    licence: {
      name: "OFL.txt",
      bytes: 4385,
      sha256: "1f9d81d094273d82f3898a1ee8b598a717d050ecbf5ff7bede105b704880157b",
    },
    files: [
      {
        name: "Caveat[wght].ttf",
        bytes: 403648,
        sha256: "0bdb6b660482d31531b3945849fba5916b3ef8695da7024a9e6b9ee3c4157988",
        weight: "400 700",
        style: "normal",
      },
    ],
  },
  {
    family: "Comic Neue",
    dir: "ofl/comicneue",
    licence: {
      name: "OFL.txt",
      bytes: 4390,
      sha256: "7c38a22e5878e60fe423360553e63dd7be23d29f1f60336034935dbfc96e8320",
    },
    files: [
      {
        name: "ComicNeue-Bold.ttf",
        bytes: 55716,
        sha256: "3e7e5fccfd7e0788f317b43312151c1bd5cf058c9697a8d83eac3939050bd61e",
        weight: "700",
        style: "normal",
      },
      {
        name: "ComicNeue-BoldItalic.ttf",
        bytes: 55928,
        sha256: "5c312c2a2fa64eee82f3b87fcfab8f3b12a5e59b043124401d322eb323cfbf16",
        weight: "700",
        style: "italic",
      },
      {
        name: "ComicNeue-Italic.ttf",
        bytes: 54392,
        sha256: "e06bfd1552f5c9464c5665733ffd69239b0593885dbb9e059688a5900f78cf98",
        weight: "400",
        style: "italic",
      },
      {
        name: "ComicNeue-Regular.ttf",
        bytes: 57248,
        sha256: "a0ee5a37c8b27c4db0700137d928598b1e23b0089e1546a8961909176b779360",
        weight: "400",
        style: "normal",
      },
    ],
  },
  {
    family: "Comic Relief",
    dir: "ofl/comicrelief",
    licence: {
      name: "OFL.txt",
      bytes: 4396,
      sha256: "009b3056cef5c9bcaff872bfb0e27fa4a0f8cc6f6984cc490caf5618748d766b",
    },
    files: [
      {
        name: "ComicRelief-Bold.ttf",
        bytes: 94684,
        sha256: "33aee007212b696afd57d50c901135cd723cd188f7ad98f3a1c572ea64e8f0d5",
        weight: "700",
        style: "normal",
      },
      {
        name: "ComicRelief-Regular.ttf",
        bytes: 80324,
        sha256: "9ef4958ab06385d91f635f83a15569786b243f9d010cfb3f9a5cdda593c7bc22",
        weight: "400",
        style: "normal",
      },
    ],
  },
  {
    family: "Dancing Script",
    dir: "ofl/dancingscript",
    licence: {
      name: "OFL.txt",
      bytes: 4443,
      sha256: "6f090277c00af96651ce6dbcc38ff1591047a3bffef486e80b6a32e8276a8201",
    },
    files: [
      {
        name: "DancingScript[wght].ttf",
        bytes: 133636,
        sha256: "21808625578fe8d8cd10cb684be546dca077b27cd03a53a2f1ec11dc743c924c",
        weight: "400 700",
        style: "normal",
      },
    ],
  },
  {
    family: "Fira Code",
    dir: "ofl/firacode",
    licence: {
      name: "OFL.txt",
      bytes: 4391,
      sha256: "926041dac670e6922505e35ac1661a4e8d20f1ffeabbbcb5edb5544370702369",
    },
    files: [
      {
        name: "FiraCode[wght].ttf",
        bytes: 260364,
        sha256: "9335b082b3c7850d98a64b584f3417f65355f3471278bb5eeb8c6c0e8657aeeb",
        weight: "400 700",
        style: "normal",
      },
    ],
  },
  {
    family: "Fira Sans",
    dir: "ofl/firasans",
    licence: {
      name: "OFL.txt",
      bytes: 4370,
      sha256: "8f24842e9174beda18a556c2ae7d54f5dc444340c19a3a9ef77e23bca366adbd",
    },
    files: [
      {
        name: "FiraSans-Bold.ttf",
        bytes: 489720,
        sha256: "a4d8e149ecdd4874a0726eb0af894488b3b31c423d6b0017c8f415ed1b795b45",
        weight: "700",
        style: "normal",
      },
      {
        name: "FiraSans-BoldItalic.ttf",
        bytes: 506864,
        sha256: "1b96c16db9819bcaa9d588068bb397bb6e977c4874965d3d50d789a1943757eb",
        weight: "700",
        style: "italic",
      },
      {
        name: "FiraSans-Italic.ttf",
        bytes: 472396,
        sha256: "a4204f9a8029c1c55daa5385ac95936f74abea3e232770f1fb2862a19d1dfa13",
        weight: "400",
        style: "italic",
      },
      {
        name: "FiraSans-Regular.ttf",
        bytes: 456996,
        sha256: "c29556a2719bf613ef3d5e070e40d903a8965d9c081beca1375dc1e6e0f93c23",
        weight: "400",
        style: "normal",
      },
    ],
  },
  {
    family: "Indie Flower",
    dir: "ofl/indieflower",
    licence: {
      name: "OFL.txt",
      bytes: 4366,
      sha256: "d9cdb075679d15a99bab2a8541b9c4fdc71347502111fbe9affd1d462219d96b",
    },
    files: [
      {
        name: "IndieFlower-Regular.ttf",
        bytes: 108196,
        sha256: "ccc94b22b156e9c5dfe50fd051f01b097600b252c24473e624bb43a143140a94",
        weight: "400",
        style: "normal",
      },
    ],
  },
  {
    family: "Inter",
    dir: "ofl/inter",
    licence: {
      name: "OFL.txt",
      bytes: 4377,
      sha256: "5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57",
    },
    files: [
      {
        name: "Inter-Italic[opsz,wght].ttf",
        bytes: 906596,
        sha256: "acd98e64795781b2058f07b18475e0ecee2a0fe2b42a49e2f9e37d0d6bf66ce6",
        weight: "400 700",
        style: "italic",
      },
      {
        name: "Inter[opsz,wght].ttf",
        bytes: 876576,
        sha256: "29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031",
        weight: "400 700",
        style: "normal",
      },
    ],
  },
  {
    family: "JetBrains Mono",
    dir: "ofl/jetbrainsmono",
    licence: {
      name: "OFL.txt",
      bytes: 4399,
      sha256: "b2fe5e8987594e9ffd1d2ca52a2f5d73eb8335243893c5d6254b5ad69269591d",
    },
    files: [
      {
        name: "JetBrainsMono-Italic[wght].ttf",
        bytes: 191556,
        sha256: "85ae2a5cd3f56baf1ce1c21a851322c58e3d8fbe8e8ad4a4d090a820dd7fe558",
        weight: "400 700",
        style: "italic",
      },
      {
        name: "JetBrainsMono[wght].ttf",
        bytes: 187208,
        sha256: "48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda",
        weight: "400 700",
        style: "normal",
      },
    ],
  },
  {
    family: "Kalam",
    dir: "ofl/kalam",
    licence: {
      name: "OFL.txt",
      bytes: 4373,
      sha256: "f62ef357d3a1c3d27edd35a6e1ba350e8a8d13499797964eeadefbf0b3b15d1f",
    },
    files: [
      {
        name: "Kalam-Bold.ttf",
        bytes: 460896,
        sha256: "2f6576601db015d4f6c08678120277fc8510b98c06e932ce7a6a9cbff4cbdded",
        weight: "700",
        style: "normal",
      },
      {
        name: "Kalam-Regular.ttf",
        bytes: 427360,
        sha256: "57cecb63d4608019371954274ae1d8c397764debd5b19d4a33c1efa4dc923c0b",
        weight: "400",
        style: "normal",
      },
    ],
  },
  {
    family: "Lato",
    dir: "ofl/lato",
    licence: {
      name: "OFL.txt",
      bytes: 4407,
      sha256: "74ba064d03f1f1c4a952da936c3eb71866c34404916734de3cae73b34357e59e",
    },
    files: [
      {
        name: "Lato-Bold.ttf",
        bytes: 656544,
        sha256: "8a0aace75d33794eece4b28187bfc1df0bbd2888b5d8a56e01788c8d65d16be1",
        weight: "700",
        style: "normal",
      },
      {
        name: "Lato-BoldItalic.ttf",
        bytes: 698364,
        sha256: "62c1b7f0d2e74b45960154c3520efc337b553db0961bfdc950d5618334596cc8",
        weight: "700",
        style: "italic",
      },
      {
        name: "Lato-Italic.ttf",
        bytes: 722900,
        sha256: "e399c44efe1387100531d26c7e4800c5d12251b890d6654a3098c7c679cb1786",
        weight: "400",
        style: "italic",
      },
      {
        name: "Lato-Regular.ttf",
        bytes: 656568,
        sha256: "d636e4683231f931eda222d588e944d082bfd3bdba02f928bee461c0f185b251",
        weight: "400",
        style: "normal",
      },
    ],
  },
  {
    family: "Lora",
    dir: "ofl/lora",
    licence: {
      name: "OFL.txt",
      bytes: 4423,
      sha256: "1d9a970809ac804b582a6ce7f0ebc4e7fefcbfd7ff6299cad35ee656a21be716",
    },
    files: [
      {
        name: "Lora-Italic[wght].ttf",
        bytes: 221232,
        sha256: "22d8d8854b53807aa664ca34f2031a9ed57a1d0dea296b8b96cdd3aad937a2b3",
        weight: "400 700",
        style: "italic",
      },
      {
        name: "Lora[wght].ttf",
        bytes: 212196,
        sha256: "822a6621ccbe8d97d20ac88c1c41f5615c9c2c202eaa75f272cd452aac6475a7",
        weight: "400 700",
        style: "normal",
      },
    ],
  },
  {
    family: "Montserrat",
    dir: "ofl/montserrat",
    licence: {
      name: "OFL.txt",
      bytes: 4400,
      sha256: "8b7141c03fa4f8d44e6345d5d4931709290f0f67875e452e95ac1fd3a027802e",
    },
    files: [
      {
        name: "Montserrat-Italic[wght].ttf",
        bytes: 762376,
        sha256: "51607f316bc020e59f03cbf51543eecffbea501c0b31d73e5b82927c5cca442c",
        weight: "400 700",
        style: "italic",
      },
      {
        name: "Montserrat[wght].ttf",
        bytes: 744936,
        sha256: "0f7b311b2f3279e4eef9b2f968bcdbab6e28f4daeb1f049f4f278a902bcd82f7",
        weight: "400 700",
        style: "normal",
      },
    ],
  },
  {
    family: "Nunito",
    dir: "ofl/nunito",
    licence: {
      name: "OFL.txt",
      bytes: 4385,
      sha256: "580df76c95a1ec5ab878ceb25bb3d85c6a076804e9c970c8c6972aea775fdf65",
    },
    files: [
      {
        name: "Nunito-Italic[wght].ttf",
        bytes: 281832,
        sha256: "b520cc871868b0acfca1beda875df7f4a44ebce914f8a89f83977fc9c09529c8",
        weight: "400 700",
        style: "italic",
      },
      {
        name: "Nunito[wght].ttf",
        bytes: 276932,
        sha256: "bb55a5ca5c2042335b3991af27c4d0705d0ef41cac6164ac737fd8f2a1e85207",
        weight: "400 700",
        style: "normal",
      },
    ],
  },
  {
    family: "Open Sans",
    dir: "ofl/opensans",
    licence: {
      name: "OFL.txt",
      bytes: 4389,
      sha256: "fbbbcfef55318de350562559b671360de6d597112ecc5c73881b05092db89602",
    },
    files: [
      {
        name: "OpenSans-Italic[wdth,wght].ttf",
        bytes: 583992,
        sha256: "fe269381e992f32e135801740998544d6235061e37c93ec067ad2be3edd5b17b",
        weight: "400 700",
        style: "italic",
      },
      {
        name: "OpenSans[wdth,wght].ttf",
        bytes: 532636,
        sha256: "36643644f318a812aab2d2ed3bb98f8cf0872527f835fe9398d95fe6b9adb878",
        weight: "400 700",
        style: "normal",
      },
    ],
  },
  {
    family: "Pacifico",
    dir: "ofl/pacifico",
    licence: {
      name: "OFL.txt",
      bytes: 4389,
      sha256: "a47e5daeda73568969395c656823102678f2eefb0d7d7ecb47aac4cc17e42204",
    },
    files: [
      {
        name: "Pacifico-Regular.ttf",
        bytes: 329380,
        sha256: "5b6c0d5334a7bf77dea52b975c5a0c408878c0f7115ed5b6fb151f634b7bf701",
        weight: "400",
        style: "normal",
      },
    ],
  },
  {
    family: "Patrick Hand",
    dir: "ofl/patrickhand",
    licence: {
      name: "OFL.txt",
      bytes: 4376,
      sha256: "377f4f9c19e935228552478eb68cc2ed82910988a60ba60e2ac73b09f32d02d1",
    },
    files: [
      {
        name: "PatrickHand-Regular.ttf",
        bytes: 214772,
        sha256: "0f173b3e6cb6d1af25babf7f0057c5ac4ee11f9992b0469bb817e967ef4ad0fc",
        weight: "400",
        style: "normal",
      },
    ],
  },
  {
    family: "Playfair Display",
    dir: "ofl/playfairdisplay",
    licence: {
      name: "OFL.txt",
      bytes: 4449,
      sha256: "566be814f8e96e93dfa16101331557eb6b5467e9e03f627c0910fe93ca12300e",
    },
    files: [
      {
        name: "PlayfairDisplay-Italic[wght].ttf",
        bytes: 278688,
        sha256: "a5e26dc5e2e77fb2803a0bf02fd4f81ee136ec8dea863ccdb0c59a263b21378b",
        weight: "400 700",
        style: "italic",
      },
      {
        name: "PlayfairDisplay[wght].ttf",
        bytes: 300724,
        sha256: "c40f2293766a503bc70cce9e512ef844a4ccb7cbcde792fe2ea31d191917d8d6",
        weight: "400 700",
        style: "normal",
      },
    ],
  },
  {
    family: "Poppins",
    dir: "ofl/poppins",
    licence: {
      name: "OFL.txt",
      bytes: 4385,
      sha256: "6be04893d770899a015649c7aa3b582f871b272f8747a92b78b17c3e5c8b2573",
    },
    files: [
      {
        name: "Poppins-Bold.ttf",
        bytes: 155996,
        sha256: "983676516167748b74de6f4771fb384c664fd913acb8b471122ecacf5da5ea6c",
        weight: "700",
        style: "normal",
      },
      {
        name: "Poppins-BoldItalic.ttf",
        bytes: 179108,
        sha256: "3572ac8116a0ac7317d342262b29937bcbaf94d8f03f90df6fe666fa7e2fb43a",
        weight: "700",
        style: "italic",
      },
      {
        name: "Poppins-Italic.ttf",
        bytes: 184544,
        sha256: "4fa76ae75b40f926420514044722cb97f32186cafd3b38263cc34dad7174d46d",
        weight: "400",
        style: "italic",
      },
      {
        name: "Poppins-Regular.ttf",
        bytes: 160316,
        sha256: "7e65201e9b79159e2300267cc885e16c8dcef2424cdfa09a29bfb0980a94a7ba",
        weight: "400",
        style: "normal",
      },
    ],
  },
  {
    family: "Quicksand",
    dir: "ofl/quicksand",
    licence: {
      name: "OFL.txt",
      bytes: 4445,
      sha256: "14d28541780d90f6577bb7abcc6f005bf6969614294e75c82abb8758a696ad46",
    },
    files: [
      {
        name: "Quicksand[wght].ttf",
        bytes: 124824,
        sha256: "39c9b64223561f56aaff6062a6f04063c4fc86809ad6768722c06614d977e1cc",
        weight: "400 700",
        style: "normal",
      },
    ],
  },
  {
    family: "Raleway",
    dir: "ofl/raleway",
    licence: {
      name: "OFL.txt",
      bytes: 4497,
      sha256: "7e946cf1171784d1015279e7dc35f827957a6b5d1f1f659ae0c98e5f5e37ed9b",
    },
    files: [
      {
        name: "Raleway-Italic[wght].ttf",
        bytes: 318476,
        sha256: "96629caf2202183fab46c70237055a7d67e6a5400b85413d45a77ed6f2a0770c",
        weight: "400 700",
        style: "italic",
      },
      {
        name: "Raleway[wght].ttf",
        bytes: 312352,
        sha256: "8bbcc3eb8275c388f4bcd998832f8a4b943eadbaf6a595205312774b5951aefb",
        weight: "400 700",
        style: "normal",
      },
    ],
  },
  {
    family: "Shadows Into Light",
    dir: "ofl/shadowsintolight",
    licence: {
      name: "OFL.txt",
      bytes: 4362,
      sha256: "0e441ae9f18ad0c294cc5b6ae3974c2db1614cab220598578b1b58c4cc334485",
    },
    files: [
      {
        name: "ShadowsIntoLight.ttf",
        bytes: 54304,
        sha256: "1347863151acdc00fa281daaba1a3543dbce5870b55f9cf7479a15bb84007681",
        weight: "400",
        style: "normal",
      },
    ],
  },
];

function entry(family: string): CatalogueFont | undefined {
  const key = family.toLowerCase();
  return FONT_CATALOGUE.find((font) => font.family.toLowerCase() === key);
}

/** How FineNotes can show a family this device lacks. */
export interface FontSource {
  /** What to download. */
  font: CatalogueFont;
  /** The name the faces are registered under. */
  face: string;
  /** For a stand-in, its scale (`size-adjust`); absent for the family itself. */
  sizeAdjust?: number;
}

/**
 * Where a family can come from: the family itself when it is in the
 * catalogue, else its stand-in, registered under a name of its own, so it
 * never covers the real family on a device that has it.
 */
export function fontSourceFor(family: string | undefined): FontSource | undefined {
  const name = cleanFamily(family);
  if (!name) return undefined;
  const own = entry(name);
  if (own) return { font: own, face: own.family };
  const standIn = STAND_INS[name.toLowerCase()];
  const font = standIn && entry(standIn.family);
  if (!standIn || !font) return undefined;
  return { font, face: standInFace(name, font.family), sizeAdjust: standIn.sizeAdjust };
}

/** The name a stand-in's faces are registered under: "Comic Relief for Chalkboard SE". */
export function standInFace(family: string, standIn: string): string {
  return `${standIn} for ${family}`;
}

/**
 * The stand-in face a box set in `family` falls back on before its typeface,
 * or undefined for none. A face that is not loaded is skipped by the
 * browser, so it can always be listed.
 */
export function standInFaceOf(family: string | undefined): string | undefined {
  const source = fontSourceFor(family);
  return source?.sizeAdjust !== undefined ? source.face : undefined;
}

/** Where a file of `font` is downloaded from. */
export function fontUrl(font: CatalogueFont, file: FontFile): string {
  return `https://raw.githubusercontent.com/google/fonts/${FONT_COMMIT}/${font.dir}/${encodeURIComponent(file.name)}`;
}

/** A font file's path in the vault: its published name, in the fonts folder. */
export function fontPath(file: FontFile, folder = FONT_FOLDER): string {
  return `${folder}/${file.name}`;
}

/** The licence's path in the vault, named for its family: "Fonts/Comic Relief OFL.txt". */
export function licencePath(font: CatalogueFont, folder = FONT_FOLDER): string {
  return `${folder}/${font.family} ${font.licence.name}`;
}

/** Bytes a download of `font` fetches, licence included. */
export function downloadSize(font: CatalogueFont): number {
  return font.files.reduce((sum, file) => sum + file.bytes, font.licence.bytes);
}

/** What the download control says: "Get Caveat (404 KB)", "Get a close open font (Comic Relief, 179 KB)". */
export function downloadLabel(source: FontSource): string {
  const size = formatSize(downloadSize(source.font));
  return source.sizeAdjust === undefined
    ? `Get ${source.font.family} (${size})`
    : `Get a close open font (${source.font.family}, ${size})`;
}

/** The families the text boxes of `pages` name, each once (ignoring case), in name order. */
export function familiesIn(
  pages: ReadonlyArray<{ textBoxes?: ReadonlyArray<{ family?: string }> }>,
): string[] {
  const seen = new Map<string, string>();
  for (const page of pages) {
    for (const box of page.textBoxes ?? []) {
      const name = cleanFamily(box.family);
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}
