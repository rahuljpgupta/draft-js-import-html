/* @flow */

import replaceTextWithMeta from './lib/replaceTextWithMeta';
import {
  CharacterMetadata,
  ContentBlock,
  ContentState,
  Entity,
  genKey,
} from 'draft-js';
import {List, Map, OrderedSet, Repeat, Seq} from 'immutable';
import {BLOCK_TYPE, ENTITY_TYPE, INLINE_STYLE} from 'draft-js-utils';
import {NODE_TYPE_ELEMENT, NODE_TYPE_TEXT} from 'synthetic-dom';
import styleToCssString from './styleToCssString';

import type {Set, IndexedSeq} from 'immutable';
import type {
  Node as SyntheticNode,
  ElementNode as SyntheticElement,
} from 'synthetic-dom';

type DOMNode = SyntheticNode | Node;
type DOMElement = SyntheticElement | Element;

type CharacterMetaSeq = IndexedSeq<CharacterMetadata>;
type Style = string;
type StyleSet = Set<Style>;

type TextFragment = {
  text: string;
  characterMeta: CharacterMetaSeq;
};

type BlockData = {[key: string]: mixed};

// A ParsedBlock has two purposes:
//   1) to keep data about the block (textFragments, type)
//   2) to act as some context for storing parser state as we parse its contents
type ParsedBlock = {
  tagName: string;
  textFragments: Array<TextFragment>;
  type: string;
  // A stack in which the last item represents the styles that will apply
  // to any text node descendants.
  styleStack: Array<StyleSet>;
  entityStack: Array<?Entity>;
  depth: number;
  data: ?BlockData;
};

type ElementStyles = {[tagName: string]: Style};
type CustomStyleMap = {[styleName: string]: { [key: string]: string }};
type CustomCssMapToStyle = {[css: string]: string};

type Options = {
  elementStyles?: ElementStyles;
  customStyleMap?: CustomStyleMap;
  customBlockFn?: (element: DOMElement) => ?{type?: string, data?: BlockData};
};

const NO_STYLE = OrderedSet();
const NO_ENTITY = null;

const EMPTY_BLOCK = new ContentBlock({
  key: genKey(),
  text: '',
  type: BLOCK_TYPE.UNSTYLED,
  characterList: List(),
  depth: 0,
});

const LINE_BREAKS = /(\r\n|\r|\n)/g;
// We use `\r` because that character is always stripped from source (normalized
// to `\n`), so it's safe to assume it will only appear in the text content when
// we put it there as a placeholder.
const SOFT_BREAK_PLACEHOLDER = '\r';
const ZERO_WIDTH_SPACE = '\u200B';
const DATA_ATTRIBUTE = /^data-([a-z0-9-]+)$/;

// Map element attributes to entity data.
const ELEM_ATTR_MAP = {
  a: {href: 'url', rel: 'rel', target: 'target', title: 'title'},
  img: {src: 'src', alt: 'alt'},
};

const getEntityData = (tagName: string, element: DOMElement) => {
  const data = {};
  if (ELEM_ATTR_MAP.hasOwnProperty(tagName)) {
    const attrMap = ELEM_ATTR_MAP[tagName];
    for (let i = 0; i < element.attributes.length; i++) {
      const {name, value} = element.attributes[i];
      if (value != null) {
        if (attrMap.hasOwnProperty(name)) {
          const newName = attrMap[name];
          data[newName] = value;
        } else if (DATA_ATTRIBUTE.test(name)) {
          data[name] = value;
        }
      }
    }
  }
  return data;
};

// Functions to convert elements to entities.
const ELEM_TO_ENTITY = {
  a(tagName: string, element: DOMElement): ?string {
    let data = getEntityData(tagName, element);
    // Don't add `<a>` elements with no href.
    if (data.url != null) {
      return Entity.create(ENTITY_TYPE.LINK, 'MUTABLE', data);
    }
  },
  img(tagName: string, element: DOMElement): ?string {
    let data = getEntityData(tagName, element);
    // Don't add `<img>` elements with no src.
    if (data.src != null) {
      return Entity.create(ENTITY_TYPE.IMAGE, 'MUTABLE', data);
    }
  },
};

// TODO: Move this out to a module.
const INLINE_ELEMENTS = {
  a: 1, abbr: 1, area: 1, audio: 1, b: 1, bdi: 1, bdo: 1, br: 1, button: 1,
  canvas: 1, cite: 1, code: 1, command: 1, datalist: 1, del: 1, dfn: 1, em: 1,
  embed: 1, i: 1, iframe: 1, img: 1, input: 1, ins: 1, kbd: 1, keygen: 1,
  label: 1, map: 1, mark: 1, meter: 1, noscript: 1, object: 1, output: 1,
  progress: 1, q: 1, ruby: 1, s: 1, samp: 1, script: 1, select: 1, small: 1,
  span: 1, strong: 1, sub: 1, sup: 1, textarea: 1, time: 1, u: 1, var: 1,
  video: 1, wbr: 1, acronym: 1, applet: 1, basefont: 1, big: 1, font: 1,
  isindex: 1, strike: 1, style: 1, tt: 1,
};

// These elements are special because they cannot contain text as a direct
// child (some cannot contain childNodes at all).
const SPECIAL_ELEMENTS = {
  area: 1, base: 1, br: 1, col: 1, colgroup: 1, command: 1, dl: 1, embed: 1,
  head: 1, hgroup: 1, hr: 1, iframe: 1, img: 1, input: 1, keygen: 1, link: 1,
  meta: 1, ol: 1, optgroup: 1, option: 1, param: 1, script: 1, select: 1,
  source: 1, style: 1, table: 1, tbody: 1, textarea: 1, tfoot: 1, thead: 1,
  title: 1, tr: 1, track: 1, ul: 1, wbr: 1, basefont: 1, dialog: 1, dir: 1,
  isindex: 1,
};

// These elements are special because they cannot contain childNodes.
const SELF_CLOSING_ELEMENTS = {img: 1};

class BlockGenerator {
  blockStack: Array<ParsedBlock>;
  blockList: Array<ParsedBlock>;
  depth: number;
  elementStyles: ElementStyles;
  customStyleMap: CustomStyleMap;

  constructor(options: Options = {}) {
    this.options = options;
    this.elementStyles = options.elementStyles || {};
    this.customStyleMap = options.customStyleMap || {};
    // This represents the hierarchy as we traverse nested elements; for
    // example [body, ul, li] where we must know li's parent type (ul or ol).
    this.blockStack = [];
    // This is a linear list of blocks that will form the output; for example
    // [p, li, li, blockquote].
    this.blockList = [];
    this.depth = 0;
  }

  process(element: DOMElement): Array<ContentBlock> {
    this.processBlockElement(element);
    let contentBlocks = [];
    this.blockList.forEach((block) => {
      let {text, characterMeta} = concatFragments(block.textFragments);
      let includeEmptyBlock = false;
      // If the block contains only a soft break then don't discard the block,
      // but discard the soft break.
      if (text === SOFT_BREAK_PLACEHOLDER) {
        includeEmptyBlock = true;
        text = '';
      }
      if (block.tagName === 'pre') {
        ({text, characterMeta} = trimLeadingNewline(text, characterMeta));
      } else {
        ({text, characterMeta} = collapseWhiteSpace(text, characterMeta));
      }
      // Previously we were using a placeholder for soft breaks. Now that we
      // have collapsed whitespace we can change it back to normal line breaks.
      text = text.split(SOFT_BREAK_PLACEHOLDER).join('\n');
      // Discard empty blocks (unless otherwise specified).
      if (text.length || includeEmptyBlock) {
        contentBlocks.push(
          new ContentBlock({
            key: genKey(),
            text: text,
            type: block.type,
            characterList: characterMeta.toList(),
            depth: block.depth,
            data: block.data ? Map(block.data) : Map(),
          })
        );
      }
    });
    if (contentBlocks.length) {
      return contentBlocks;
    } else {
      return [EMPTY_BLOCK];
    }
  }

  getBlockTypeFromTagName(tagName: string): string {
    switch (tagName) {
      case 'li': {
        let parent = this.blockStack.slice(-1)[0];
        return (parent.tagName === 'ol') ?
          BLOCK_TYPE.ORDERED_LIST_ITEM :
          BLOCK_TYPE.UNORDERED_LIST_ITEM;
      }
      case 'blockquote': {
        return BLOCK_TYPE.BLOCKQUOTE;
      }
      case 'h1': {
        return BLOCK_TYPE.HEADER_ONE;
      }
      case 'h2': {
        return BLOCK_TYPE.HEADER_TWO;
      }
      case 'h3': {
        return BLOCK_TYPE.HEADER_THREE;
      }
      case 'h4': {
        return BLOCK_TYPE.HEADER_FOUR;
      }
      case 'h5': {
        return BLOCK_TYPE.HEADER_FIVE;
      }
      case 'h6': {
        return BLOCK_TYPE.HEADER_SIX;
      }
      case 'pre': {
        return BLOCK_TYPE.CODE;
      }
      case 'figure': {
        return BLOCK_TYPE.ATOMIC;
      }
      default: {
        return BLOCK_TYPE.UNSTYLED;
      }
    }
  }

  processBlockElement(element: DOMElement) {
    if (!element) {
      return;
    }
    let tagName = element.nodeName.toLowerCase();
    let {customBlockFn} = this.options;
    let type: ?string;
    let data: ?BlockData;
    if (customBlockFn) {
      let customBlock = customBlockFn(element);
      if (customBlock ) {
        type = customBlock.type;
        data = customBlock.data;
      }
    }
    if (!type) {
      type = this.getBlockTypeFromTagName(tagName);
    }
    let hasDepth = canHaveDepth(type);
    let allowRender = !SPECIAL_ELEMENTS.hasOwnProperty(tagName);
    let block: ParsedBlock = {
      tagName: tagName,
      textFragments: [],
      type: type,
      styleStack: [NO_STYLE],
      entityStack: [NO_ENTITY],
      depth: hasDepth ? this.depth : 0,
      data,
    };
    if (allowRender) {
      this.blockList.push(block);
      if (hasDepth) {
        this.depth += 1;
      }
    }
    this.blockStack.push(block);
    if (element.childNodes != null) {
      Array.from(element.childNodes).forEach(this.processNode, this);
    }
    this.blockStack.pop();
    if (allowRender && hasDepth) {
      this.depth -= 1;
    }
  }

  processInlineElement(element: DOMElement) {
    let tagName = element.nodeName.toLowerCase();
    if (tagName === 'br') {
      this.processText(SOFT_BREAK_PLACEHOLDER);
      return;
    }
    let block = this.blockStack.slice(-1)[0];
    let style = block.styleStack.slice(-1)[0];
    let entityKey = block.entityStack.slice(-1)[0];
    style = addStyleFromTagName(style, tagName, this.elementStyles);
    let styleAttribute = element.getAttribute('style');
    if (styleAttribute) {
      const customCssMapToStyle = {};
      const normalizeStyle = str => str.replace(/ /g, '').replace(/;/g, '');

      // Convert react styles to css string values
      Object.keys(this.customStyleMap).forEach((key) => {
        customCssMapToStyle[normalizeStyle(styleToCssString(this.customStyleMap[key]))] = key;
      });
      
      for (let styleValue of styleAttribute.split(';')) {
        const styleAttr = normalizeStyle(styleValue);
        if (styleAttr) {
          style = addStyleFromStyleAttribute(style, styleAttr, customCssMapToStyle);
        }
      }
    }
    if (ELEM_TO_ENTITY.hasOwnProperty(tagName)) {
      // If the to-entity function returns nothing, use the existing entity.
      entityKey = ELEM_TO_ENTITY[tagName](tagName, element) || entityKey;
    }
    block.styleStack.push(style);
    block.entityStack.push(entityKey);
    if (element.childNodes != null) {
      Array.from(element.childNodes).forEach(this.processNode, this);
    }
    if (SELF_CLOSING_ELEMENTS.hasOwnProperty(tagName)) {
      this.processText('~');
    }
    block.entityStack.pop();
    block.styleStack.pop();
  }

  processTextNode(node: DOMNode) {
    let text = node.nodeValue;
    // This is important because we will use \r as a placeholder for a soft break.
    text = text.replace(LINE_BREAKS, '\n');
    // Replace zero-width space (we use it as a placeholder in markdown) with a
    // soft break.
    // TODO: The import-markdown package should correctly turn breaks into <br>
    // elements so we don't need to include this hack.
    text = text.split(ZERO_WIDTH_SPACE).join(SOFT_BREAK_PLACEHOLDER);
    this.processText(text);
  }

  processText(text: string) {
    let block = this.blockStack.slice(-1)[0];
    let style = block.styleStack.slice(-1)[0];
    let entity = block.entityStack.slice(-1)[0];
    let charMetadata = CharacterMetadata.create({
      style: style,
      entity: entity,
    });
    let seq: CharacterMetaSeq = Repeat(charMetadata, text.length);
    block.textFragments.push({
      text: text,
      characterMeta: seq,
    });
  }

  processNode(node: DOMNode) {
    if (node.nodeType === NODE_TYPE_ELEMENT) {
      let element: DOMElement = node;
      let tagName = element.nodeName.toLowerCase();
      if (INLINE_ELEMENTS.hasOwnProperty(tagName)) {
        this.processInlineElement(element);
      } else {
        this.processBlockElement(element);
      }
    } else if (node.nodeType === NODE_TYPE_TEXT) {
      this.processTextNode(node);
    }
  }
}

function trimLeadingNewline(text: string, characterMeta: CharacterMetaSeq): TextFragment {
  if (text.charAt(0) === '\n') {
    text = text.slice(1);
    characterMeta = characterMeta.slice(1);
  }
  return {text, characterMeta};
}

function trimLeadingSpace(text: string, characterMeta: CharacterMetaSeq): TextFragment {
  while (text.charAt(0) === ' ') {
    text = text.slice(1);
    characterMeta = characterMeta.slice(1);
  }
  return {text, characterMeta};
}

function trimTrailingSpace(text: string, characterMeta: CharacterMetaSeq): TextFragment {
  while (text.slice(-1) === ' ') {
    text = text.slice(0, -1);
    characterMeta = characterMeta.slice(0, -1);
  }
  return {text, characterMeta};
}

function collapseWhiteSpace(text: string, characterMeta: CharacterMetaSeq): TextFragment {
  text = text.replace(/[ \t\n]/g, ' ');
  ({text, characterMeta} = trimLeadingSpace(text, characterMeta));
  ({text, characterMeta} = trimTrailingSpace(text, characterMeta));
  let i = text.length;
  while (i--) {
    if (text.charAt(i) === ' ' && text.charAt(i - 1) === ' ') {
      text = text.slice(0, i) + text.slice(i + 1);
      characterMeta = characterMeta.slice(0, i)
        .concat(characterMeta.slice(i + 1));
    }
  }
  // There could still be one space on either side of a softbreak.
  ({text, characterMeta} = replaceTextWithMeta(
    {text, characterMeta},
    SOFT_BREAK_PLACEHOLDER + ' ',
    SOFT_BREAK_PLACEHOLDER,
  ));
  ({text, characterMeta} = replaceTextWithMeta(
    {text, characterMeta},
    ' ' + SOFT_BREAK_PLACEHOLDER,
    SOFT_BREAK_PLACEHOLDER,
  ));
  return {text, characterMeta};
}

function canHaveDepth(blockType: string): boolean {
  switch (blockType) {
    case BLOCK_TYPE.UNORDERED_LIST_ITEM:
    case BLOCK_TYPE.ORDERED_LIST_ITEM: {
      return true;
    }
    default: {
      return false;
    }
  }
}

function concatFragments(fragments: Array<TextFragment>): TextFragment {
  let text = '';
  let characterMeta: CharacterMetaSeq = Seq();
  fragments.forEach((textFragment: TextFragment) => {
    text = text + textFragment.text;
    characterMeta = characterMeta.concat(textFragment.characterMeta);
  });
  return {text, characterMeta};
}


function addStyleFromTagName(styleSet: StyleSet, tagName: string, elementStyles?: ElementStyles): StyleSet {
  switch (tagName) {
    case 'b':
    case 'strong': {
      return styleSet.add(INLINE_STYLE.BOLD);
    }
    case 'i':
    case 'em': {
      return styleSet.add(INLINE_STYLE.ITALIC);
    }
    case 'ins': {
      return styleSet.add(INLINE_STYLE.UNDERLINE);
    }
    case 'code': {
      return styleSet.add(INLINE_STYLE.CODE);
    }
    case 'del': {
      return styleSet.add(INLINE_STYLE.STRIKETHROUGH);
    }
    default: {
      // Allow custom element styles to be provided.
      if (elementStyles && elementStyles[tagName]) {
        return styleSet.add(elementStyles[tagName]);
      }

      return styleSet;
    }
  }
}

function addStyleFromStyleAttribute(styleSet: StyleSet, styleAttributeValue: string, customCssMapToStyle: CustomCssMapToStyle): StyleSet {
  // Allow custom css styles to be provided
  if (Object.keys(customCssMapToStyle).indexOf(styleAttributeValue) >= 0) {
    return styleSet.add(customCssMapToStyle[styleAttributeValue]);
  }

  return styleSet;
}

export default function stateFromElement(element: DOMElement, options?: Options): ContentState {
  let blocks = new BlockGenerator(options).process(element);
  return ContentState.createFromBlockArray(blocks);
}
