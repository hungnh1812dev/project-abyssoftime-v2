import { CKEditor } from "@ckeditor/ckeditor5-react";
import {
  Alignment,
  BlockQuote,
  Bold,
  ClassicEditor,
  CodeBlock,
  Essentials,
  FontBackgroundColor,
  FontColor,
  FontFamily,
  FontSize,
  Heading,
  Indent,
  Italic,
  Link,
  List,
  Paragraph,
  SourceEditing,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  TableToolbar,
  TodoList,
  Underline,
} from "ckeditor5";
import "ckeditor5/ckeditor5.css";
import { type Control, Controller } from "react-hook-form";

interface RichTextInputProps {
  name?: string;
  control?: Control;
  toolbar?: string[];
}

const DEFAULT_TOOLBAR = [
  "undo",
  "redo",
  "|",
  "heading",
  "|",
  "fontfamily",
  "fontsize",
  "fontColor",
  "fontBackgroundColor",
  "|",
  "bold",
  "italic",
  "strikethrough",
  "subscript",
  "superscript",
  "underline",
  "|",
  "link",
  "blockQuote",
  "codeBlock",
  "|",
  "alignment",
  "|",
  "bulletedList",
  "numberedList",
  "todoList",
  "outdent",
  "indent",
  "|",
  "insertTable",
  "|",
  "sourceEditing",
];

const PLUGINS = [
  Essentials,
  Paragraph,
  Bold,
  Italic,
  Heading,
  Link,
  List,
  BlockQuote,
  Indent,
  Table,
  TableToolbar,
  SourceEditing,
  FontFamily,
  FontSize,
  FontColor,
  FontBackgroundColor,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
  Alignment,
  CodeBlock,
  TodoList,
];

const contentStyles = `
  .ck-editor__editable_inline { min-height: 12em; }
  .ck-content ul, .ck-content ol {
    padding-inline-start: 40px;
    margin-block-start: 1em;
    margin-block-end: 1em;
  }
`;

export function RichTextInput({ name, control, toolbar }: RichTextInputProps) {
  return (
    <Controller
      name={name ?? ""}
      control={control}
      defaultValue=""
      render={({ field }) => (
        <>
          <style>{contentStyles}</style>
          <CKEditor
            editor={ClassicEditor}
            data={(field.value as string) ?? ""}
            config={{
              licenseKey: "GPL",
              plugins: PLUGINS,
              toolbar: toolbar ?? DEFAULT_TOOLBAR,
            }}
            onChange={(_event, editor) => {
              field.onChange(editor.getData());
            }}
          />
        </>
      )}
    />
  );
}
