import DOMPurify from "dompurify";
import type { HTMLReactParserOptions } from "html-react-parser";
import HTMLReactParser from "html-react-parser/lib/index";

interface HTMLParserProps {
  content: string;
  options?: HTMLReactParserOptions;
  component?: keyof React.JSX.IntrinsicElements;
  className?: string;
  allowedTags?: string[];
}

const defaultOptions: HTMLReactParserOptions = {};

const DEFAULT_ALLOWED_TAGS = ["strong", "b", "em", "i", "mark", "br"];

export const HTMLParser = ({ content, options, component = "div", className, allowedTags = DEFAULT_ALLOWED_TAGS }: HTMLParserProps) => {
  const Comp = component;
  if (!content) return null;
  const clean = DOMPurify.sanitize(content, { ALLOWED_TAGS: allowedTags, ALLOWED_ATTR: [] });
  return <Comp className={className}>{HTMLReactParser(clean, options || defaultOptions)}</Comp>;
};
