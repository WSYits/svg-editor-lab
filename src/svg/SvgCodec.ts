import { createRequire } from 'node:module';
import { SvgDocument } from '../domain/SvgDocument.js';
import { ShapeFactory } from '../domain/ShapeFactory.js';
import { PreservedAttributes } from '../domain/PreservedAttributes.js';
import type { Shape, AttributeValue } from '../domain/Shape.js';

// saxes 6 ships declarations incompatible with exactOptionalPropertyTypes / TS 7.
// Keep the application strict; describe only the public runtime API used here.
interface XmlEvents {
  error: Error;
  doctype: string;
  processinginstruction: { target: string; body: string };
  xmldecl: { version: string | undefined; encoding: string | undefined };
  opentagstart: unknown;
  opentag: { uri: string; local: string; attributes: Record<string, { uri: string; local: string; name: string; value: string }> };
  text: string;
  cdata: string;
  comment: string;
  closetag: unknown;
}
interface XmlParser {
  on<K extends keyof XmlEvents>(event: K, handler: (value: XmlEvents[K]) => void): void;
  write(source: string): XmlParser;
  close(): void;
}
const { SaxesParser } = createRequire(import.meta.url)('saxes') as {
  SaxesParser: new (options: { xmlns: boolean; defaultXMLVersion: string; forceXMLVersion: boolean }) => XmlParser;
};

interface XmlElement {
  readonly name: string;
  readonly attributes: Record<string, string>;
  readonly children: XmlElement[];
  text: string;
}
export interface SvgLimits {
  readonly maxBytes?: number;
  readonly maxNodes?: number;
  readonly maxDepth?: number;
}
export interface DecodedSvg {
  /** A fresh caller-owned document, never cached by the codec. */
  readonly document: SvgDocument;
  readonly warnings: readonly string[];
}

/** Pure string/model codec: no file system, application state or terminal access. */
export class SvgCodec {
  static readonly #namespace = 'http://www.w3.org/2000/svg';
  static readonly #xmlNamespace = 'http://www.w3.org/XML/1998/namespace';
  readonly #maxBytes: number;
  readonly #maxNodes: number;
  readonly #maxDepth: number;
  readonly #factory = new ShapeFactory();

  constructor(limits: SvgLimits = {}) {
    this.#maxBytes = limits.maxBytes ?? 1024 * 1024;
    this.#maxNodes = limits.maxNodes ?? 10000;
    this.#maxDepth = limits.maxDepth ?? 64;
    for (const value of [this.#maxBytes, this.#maxNodes, this.#maxDepth]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error('SVG limits must be positive safe integers');
    }
  }

  decode(source: string): DecodedSvg {
    this.#checkBytes(source);
    const root = this.#parse(source);
    const width = this.#dimension(root.attributes.width, 'width');
    const height = this.#dimension(root.attributes.height, 'height');
    const rootMetadata = { ...root.attributes };
    delete rootMetadata.width; delete rootMetadata.height;
    if (rootMetadata.viewBox !== undefined) {
      if (/,\s*,/u.test(rootMetadata.viewBox)) throw new Error('invalid viewBox separators');
      const parts = rootMetadata.viewBox.trim().split(/[\s,]+/u);
      const values = parts.map(value => PreservedAttributes.number(value, 'viewBox'));
      if (values.length !== 4 || values[0] !== 0 || values[1] !== 0 || values[2] !== width || values[3] !== height) {
        throw new Error('unsupported viewBox: expected 0 0 width height');
      }
      delete rootMetadata.viewBox;
    }
    const document = new SvgDocument(width, height);
    document.setPreservedAttributes(rootMetadata);
    const ordered: XmlElement[] = [];
    const visit = (node: XmlElement): void => { ordered.push(node); node.children.forEach(visit); };
    root.children.forEach(visit);
    const ids = new Set<string>();
    for (const node of ordered) {
      const id = node.attributes.id;
      if (id !== undefined) {
        this.#id(id);
        if (ids.has(id)) throw new Error(`id already exists: ${id}`);
        ids.add(id);
      }
    }
    const assigned = new Map<XmlElement, string>();
    const counters = new Map<string, number>();
    const warnings: string[] = [];
    for (const node of ordered) {
      let id = node.attributes.id;
      if (id === undefined) {
        let number = counters.get(node.name) ?? 1;
        do { id = `${node.name}${number++}`; } while (ids.has(id));
        counters.set(node.name, number); ids.add(id);
        warnings.push(`warning: assigned id ${id} to unnamed <${node.name}>`);
      }
      assigned.set(node, id);
    }
    const insert = (node: XmlElement, parentId?: string): void => {
      const description = this.#factory.describeSvg(node.name);
      const attributes: Record<string, AttributeValue> = {};
      const preserved = { ...node.attributes }; delete preserved.id;
      for (const name of description.numericAttributes) {
        const raw = preserved[name];
        if (raw === undefined) throw new Error(`missing SVG attribute: ${name} on <${node.name}>`);
        attributes[name] = PreservedAttributes.length(raw, name);
        delete preserved[name];
      }
      for (const name of ['fill', 'stroke', 'stroke-width']) {
        const raw = preserved[name];
        if (raw !== undefined) {
          if (name === 'stroke-width') attributes[name] = PreservedAttributes.length(raw, name, true);
          else { PreservedAttributes.assertPaint(raw); attributes[name] = raw; }
          delete preserved[name];
        }
      }
      if (description.content === 'text') attributes.text = node.text;
      const id = assigned.get(node)!;
      const shape = this.#factory.create(node.name, id, attributes);
      shape.setPreservedAttributes(preserved);
      document.insert(shape, parentId);
      node.children.forEach(child => insert(child, id));
    };
    root.children.forEach(node => insert(node));
    return Object.freeze({ document, warnings: Object.freeze(warnings) });
  }

  encode(document: SvgDocument): string {
    let nodes = 1;
    let bytes = 0;
    const chunks: string[] = [];
    const append = (chunk: string): void => {
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > this.#maxBytes) throw new Error('SVG byte limit exceeded');
      chunks.push(chunk);
    };
    const rootAttributes: Record<string, string | number> = { xmlns: SvgCodec.#namespace,
      width: document.width, height: document.height, viewBox: `0 0 ${document.width} ${document.height}`,
      ...document.getPreservedAttributes() };
    const serialize = (shape: Shape, depth: number): void => {
      if (++nodes > this.#maxNodes) throw new Error('SVG node limit exceeded');
      if (depth > this.#maxDepth) throw new Error('SVG depth limit exceeded');
      const description = this.#factory.describeSvg(shape.type);
      this.#id(shape.id);
      const attributes = { ...shape.getAttributes(), ...shape.getPreservedAttributes() };
      const text = attributes.text; delete attributes.text;
      // CLI accepts opaque paint strings; this SVG subset rejects references.
      for (const name of ['fill', 'stroke']) {
        const value = attributes[name];
        if (value !== undefined) PreservedAttributes.assertPaint(String(value));
      }
      if (description.content !== 'container' && shape.children.length > 0) throw new Error('non-container SVG node has children');
      const hasBody = description.content === 'text' || shape.children.length > 0;
      append(`<${shape.type}${this.#attributes(attributes)}${hasBody ? '>' : '/>'}`);
      if (description.content === 'text') {
        const content = String(text ?? '');
        if (content !== '' && ++nodes > this.#maxNodes) throw new Error('SVG node limit exceeded');
        append(this.#escape(content, false));
      }
      else shape.children.forEach(child => serialize(child, depth + 1));
      if (hasBody) append(`</${shape.type}>`);
    };
    append(`<?xml version="1.0" encoding="UTF-8"?>\n<svg${this.#attributes(rootAttributes)}>`);
    document.roots.forEach(shape => serialize(shape, 2));
    append('</svg>');
    return chunks.join('');
  }

  #parse(source: string): XmlElement {
    const parser = new SaxesParser({ xmlns: true, defaultXMLVersion: '1.0', forceXMLVersion: true });
    const stack: XmlElement[] = [];
    let root: XmlElement | undefined;
    let count = 0;
    const countNode = (): void => { if (++count > this.#maxNodes) throw new Error('SVG node limit exceeded'); };
    parser.on('error', error => { throw new Error(`invalid XML: ${error.message}`); });
    parser.on('doctype', () => { throw new Error('DTD and external entities are not supported'); });
    parser.on('processinginstruction', () => { throw new Error('XML processing instructions are not supported'); });
    parser.on('xmldecl', declaration => {
      if (declaration.version !== '1.0' || (declaration.encoding !== undefined && !/^utf-8$/iu.test(declaration.encoding))) {
        throw new Error('only XML 1.0 UTF-8 is supported');
      }
    });
    parser.on('opentagstart', () => {
      countNode();
      if (stack.length + 1 > this.#maxDepth) throw new Error('SVG depth limit exceeded');
    });
    parser.on('opentag', tag => {
      if (tag.uri !== SvgCodec.#namespace) throw new Error(`unsupported SVG namespace: ${tag.uri || '(missing)'}`);
      const parent = stack.at(-1);
      if (!parent && tag.local !== 'svg') throw new Error('expected SVG root element');
      if (parent) {
        const content = parent === root ? 'container' : this.#factory.describeSvg(parent.name).content;
        if (content !== 'container') throw new Error(`unsupported child element inside <${parent.name}>`);
        this.#factory.describeSvg(tag.local); // Factory is the sole graphic type registry.
      }
      const attributes: Record<string, string> = {};
      for (const attribute of Object.values(tag.attributes)) {
        if (attribute.uri === 'http://www.w3.org/2000/xmlns/') {
          if (attribute.value !== SvgCodec.#namespace && attribute.value !== SvgCodec.#xmlNamespace) {
            throw new Error('unsupported namespace declaration');
          }
          continue;
        }
        const name = attribute.uri === SvgCodec.#xmlNamespace && attribute.local === 'space' ? 'xml:space' : attribute.name;
        if (attribute.uri !== '' && name !== 'xml:space') throw new Error(`unsupported namespaced attribute: ${attribute.name}`);
        if (name === 'transform') throw new Error('transform is not supported in Phase 1');
        if (name === 'style' || /^on/iu.test(name) || ['href', 'src'].includes(name)) throw new Error(`unsupported CSS, event or resource attribute: ${name}`);
        // An inert data-* name cannot be __proto__, but raw XML attributes can.
        Object.defineProperty(attributes, name, { value: attribute.value, enumerable: true, configurable: true, writable: true });
      }
      const node: XmlElement = { name: tag.local, attributes, children: [], text: '' };
      if (parent) parent.children.push(node); else root = node;
      stack.push(node);
    });
    const text = (value: string): void => {
      const node = stack.at(-1);
      if (!node && value.trim() === '') return;
      countNode();
      const content = node && node !== root ? this.#factory.describeSvg(node.name).content : 'container';
      if (node && content === 'text') node.text += value;
      else if (value.trim() !== '') throw new Error('unexpected text outside a text element');
    };
    parser.on('text', text); parser.on('cdata', text);
    parser.on('comment', countNode);
    parser.on('closetag', () => { stack.pop(); });
    parser.write(source).close();
    if (!root) throw new Error('expected SVG root element');
    return root;
  }

  #dimension(raw: string | undefined, name: string): number {
    if (raw === undefined) throw new Error(`missing SVG canvas ${name}`);
    const value = PreservedAttributes.length(raw, name);
    if (value <= 0) throw new Error(`SVG canvas ${name} must be positive`);
    return value;
  }

  #id(id: string): void {
    if (!id || /\s/u.test(id)) throw new Error('SVG id must be nonempty and contain no whitespace');
    PreservedAttributes.assertXmlText(id);
  }

  #attributes(attributes: Readonly<Record<string, string | number>>): string {
    const chunks: string[] = [];
    let bytes = 0;
    for (const [name, value] of Object.entries(attributes)) {
      const chunk = ` ${name}="${this.#escape(String(value), true)}"`;
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > this.#maxBytes) throw new Error('SVG byte limit exceeded');
      chunks.push(chunk);
    }
    return chunks.join('');
  }

  #escape(value: string, attribute: boolean): string {
    this.#checkBytes(value);
    PreservedAttributes.assertXmlText(value);
    return value.replace(/[&<>"\r\n\t]/gu, char => {
      if (char === '&') return '&amp;';
      if (char === '<') return '&lt;';
      if (char === '>') return '&gt;';
      if (char === '"') return attribute ? '&quot;' : '"';
      return `&#${char.charCodeAt(0)};`;
    });
  }

  #checkBytes(source: string): void {
    if (Buffer.byteLength(source, 'utf8') > this.#maxBytes) throw new Error('SVG byte limit exceeded');
  }
}
