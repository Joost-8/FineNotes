import { describe, expect, it } from "vitest";
import { TOOL_DIALECTS, geminiSchema } from "../../src/recognition/ask-tool-dialects";
import { ASK_TOOLS } from "../../src/recognition/ask-tools";

const page = { base64: "P3", mimeType: "image/png" as const };

describe("tool dialects", () => {
  it("OpenAI: declares functions, reads tool_calls, answers with tool messages and the pages after", () => {
    const openai = TOOL_DIALECTS.openai;
    const body = openai.body(
      { model: "m", messages: [{ role: "user", content: "Q" }] },
      [],
      false,
    ) as {
      tools: Array<{ type: string; function: { name: string; parameters: unknown } }>;
      messages: unknown[];
      tool_choice?: unknown;
    };
    expect(body.tools.map((t) => t.function.name)).toEqual(ASK_TOOLS.map((t) => t.name));
    expect(body.tools[0].type).toBe("function");
    expect(body.tool_choice).toBeUndefined();
    expect((openai.body({ messages: [] }, [], true) as { tool_choice: unknown }).tool_choice).toBe(
      "none",
    );

    const reply = {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            refusal: null,
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: { name: "read_pages", arguments: '{"pages":[3]}' },
              },
              {
                id: "c2",
                type: "function",
                function: { name: "go_to_page", arguments: "{broken" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    expect(openai.calls(reply)).toEqual([
      { id: "c1", name: "read_pages", input: { pages: [3] } },
      { id: "c2", name: "go_to_page", input: {} },
    ]);
    // Only the fields the API takes back.
    expect(openai.reply(reply)).toEqual([
      { role: "assistant", content: null, tool_calls: reply.choices[0].message.tool_calls },
    ]);
    const [c1, c2] = openai.calls(reply);
    expect(
      openai.results([
        { use: c1, text: "Page 3 of 9.", images: [page] },
        { use: c2, text: "No such page.", isError: true },
      ]),
    ).toEqual([
      { role: "tool", tool_call_id: "c1", content: "Page 3 of 9." },
      { role: "tool", tool_call_id: "c2", content: "Error: No such page." },
      {
        role: "user",
        content: [
          { type: "text", text: "The page images read_pages returned, in order." },
          { type: "image_url", image_url: { url: "data:image/png;base64,P3" } },
        ],
      },
    ]);
    expect(openai.calls({ choices: [{ message: { content: "An answer." } }] })).toEqual([]);
  });

  it("Gemini: declares functions in its schema subset, and passes the reply back as it came", () => {
    const google = TOOL_DIALECTS.google;
    const body = google.body(
      { contents: [{ role: "user", parts: [{ text: "Q" }] }] },
      [],
      false,
    ) as {
      tools: Array<{ functionDeclarations: Array<{ name: string; parameters: unknown }> }>;
      contents: unknown[];
    };
    const declarations = body.tools[0].functionDeclarations;
    expect(declarations.map((d) => d.name)).toEqual(ASK_TOOLS.map((t) => t.name));
    expect(JSON.stringify(declarations)).not.toMatch(
      /additionalProperties|minimum|minItems|maxItems/,
    );
    expect((google.body({ contents: [] }, [], true) as { toolConfig: unknown }).toolConfig).toEqual(
      { functionCallingConfig: { mode: "NONE" } },
    );

    const content = {
      role: "model",
      parts: [
        { text: "", thoughtSignature: "sig" },
        { functionCall: { name: "search_notebook", args: { query: "ATP" } } },
        { functionCall: { id: "f2", name: "go_to_page", args: { page: 2 } } },
      ],
    };
    const reply = { candidates: [{ content }] };
    const calls = google.calls(reply);
    expect(calls).toEqual([
      { id: "", name: "search_notebook", input: { query: "ATP" } },
      { id: "f2", name: "go_to_page", input: { page: 2 } },
    ]);
    expect(google.reply(reply)).toEqual([content]);
    expect(
      google.results([
        { use: calls[0], text: "Page 3: …ATP…", images: [page] },
        { use: calls[1], text: "No such page.", isError: true },
      ]),
    ).toEqual([
      {
        role: "user",
        parts: [
          { functionResponse: { name: "search_notebook", response: { result: "Page 3: …ATP…" } } },
          {
            functionResponse: {
              id: "f2",
              name: "go_to_page",
              response: { error: "No such page." },
            },
          },
          { inline_data: { mime_type: "image/png", data: "P3" } },
        ],
      },
    ]);
  });

  it("strips only the keywords Gemini rejects", () => {
    expect(
      geminiSchema({
        type: "object",
        additionalProperties: false,
        properties: {
          pages: { type: "array", minItems: 1, items: { type: "integer", minimum: 1 } },
        },
        required: ["pages"],
      }),
    ).toEqual({
      type: "object",
      properties: { pages: { type: "array", items: { type: "integer" } } },
      required: ["pages"],
    });
  });
});
