import { FormField } from "../../FormField";
import { FormProvider } from "../../FormProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// CKEditor cannot run in jsdom — mock it with a controlled textarea that
// mirrors the real onChange(event, editor) API.
let lastCapturedConfig: unknown = undefined;

vi.mock("@ckeditor/ckeditor5-react", () => ({
  CKEditor: ({ data, onChange, config }: { data: string; onChange: (event: null, editor: { getData: () => string }) => void; config?: unknown }) => {
    lastCapturedConfig = config;
    return <textarea data-testid="ckeditor-mock" defaultValue={data} onChange={(e) => onChange(null, { getData: () => e.target.value })} />;
  },
}));

vi.mock("ckeditor5", () => ({
  ClassicEditor: class MockEditor {},
  Essentials: class {},
  Paragraph: class {},
  Bold: class {},
  Italic: class {},
  Heading: class {},
  Link: class {},
  List: class {},
  BlockQuote: class {},
  Indent: class {},
  MediaEmbed: class {},
  Table: class {},
  TableToolbar: class {},
  SourceEditing: class {},
  FontFamily: class {},
  FontSize: class {},
  FontColor: class {},
  FontBackgroundColor: class {},
  Strikethrough: class {},
  Subscript: class {},
  Superscript: class {},
  Underline: class {},
  Alignment: class {},
  CodeBlock: class {},
  TodoList: class {},
}));

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={createClient()}>{children}</QueryClientProvider>;
}

// Import after mocks are registered
const { RichTextInput } = await import("../RichTextInput");

describe("RichTextInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastCapturedConfig = undefined;
  });

  it("renders the CKEditor", () => {
    const mutationFn = vi.fn().mockResolvedValue(undefined);
    render(
      <Wrapper>
        <FormProvider mutationFn={mutationFn}>
          <FormField name="body">
            <RichTextInput />
          </FormField>
        </FormProvider>
      </Wrapper>,
    );
    expect(screen.getByTestId("ckeditor-mock")).toBeInTheDocument();
  });

  it("updates form value when editor content changes", async () => {
    const user = userEvent.setup();
    const mutationFn = vi.fn().mockResolvedValue(undefined);

    render(
      <Wrapper>
        <FormProvider mutationFn={mutationFn}>
          <FormField name="body">
            <RichTextInput />
          </FormField>
          <button type="submit">Submit</button>
        </FormProvider>
      </Wrapper>,
    );

    const editor = screen.getByTestId("ckeditor-mock");
    await user.clear(editor);
    await user.type(editor, "<p>Hello</p>");
    await user.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(mutationFn.mock.calls[0][0]).toEqual({ body: "<p>Hello</p>" });
    });
  });

  it("injects min-height style for .ck-editor__editable_inline", () => {
    render(
      <Wrapper>
        <FormProvider mutationFn={vi.fn().mockResolvedValue(undefined)}>
          <FormField name="body">
            <RichTextInput />
          </FormField>
        </FormProvider>
      </Wrapper>,
    );
    const styles = Array.from(document.querySelectorAll("style"));
    const hasMinHeight = styles.some((s) => s.textContent?.includes(".ck-editor__editable_inline") && s.textContent?.includes("min-height: 12em"));
    expect(hasMinHeight).toBe(true);
  });

  it("forwards toolbar prop to CKEditor config when provided", () => {
    const toolbar = ["bold", "italic"];
    render(
      <Wrapper>
        <FormProvider mutationFn={vi.fn().mockResolvedValue(undefined)}>
          <FormField name="body">
            <RichTextInput toolbar={toolbar} />
          </FormField>
        </FormProvider>
      </Wrapper>,
    );
    expect((lastCapturedConfig as { toolbar?: string[] })?.toolbar).toEqual(toolbar);
  });

  it("uses default toolbar when prop is omitted", () => {
    render(
      <Wrapper>
        <FormProvider mutationFn={vi.fn().mockResolvedValue(undefined)}>
          <FormField name="body">
            <RichTextInput />
          </FormField>
        </FormProvider>
      </Wrapper>,
    );
    const config = lastCapturedConfig as { toolbar?: string[] };
    expect(config?.toolbar).toBeDefined();
    expect(config.toolbar).toContain("bold");
  });

  it("stores HTML string (not DOM nodes) in form state", async () => {
    const user = userEvent.setup();
    const mutationFn = vi.fn().mockResolvedValue(undefined);

    render(
      <Wrapper>
        <FormProvider mutationFn={mutationFn}>
          <FormField name="content">
            <RichTextInput />
          </FormField>
          <button type="submit">Submit</button>
        </FormProvider>
      </Wrapper>,
    );

    await user.clear(screen.getByTestId("ckeditor-mock"));
    await user.type(screen.getByTestId("ckeditor-mock"), "<h1>Title</h1>");
    await user.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      const submitted = mutationFn.mock.calls[0][0] as Record<string, unknown>;
      expect(typeof submitted.content).toBe("string");
    });
  });
});
