'use strict';

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _expect = require('expect');

var _expect2 = _interopRequireDefault(_expect);

var _stateFromElement = require('../stateFromElement');

var _stateFromElement2 = _interopRequireDefault(_stateFromElement);

var _syntheticDom = require('synthetic-dom');

var _draftJs = require('draft-js');

var _jsdom = require('jsdom');

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _path = require('path');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectWithoutProperties(obj, keys) { var target = {}; for (var i in obj) { if (keys.indexOf(i) >= 0) continue; if (!Object.prototype.hasOwnProperty.call(obj, i)) continue; target[i] = obj[i]; } return target; }

var _global = global;
var describe = _global.describe;
var it = _global.it;


var document = (0, _jsdom.jsdom)('<!doctype html><html><body></body></html>');

// This separates the test cases in `data/test-cases.txt`.
var SEP = '\n\n#';

var testCasesRaw = _fs2.default.readFileSync((0, _path.join)(__dirname, '..', '..', 'test', 'test-cases.txt'), 'utf8');

var testCases = testCasesRaw.slice(1).trim().split(SEP).map(function (text) {
  var lines = text.split('\n');
  var description = lines.shift().trim();
  var state = removeBlockKeys(JSON.parse(lines[0]));
  var html = lines.slice(1).join('\n');
  return { description: description, state: state, html: html };
});

describe('stateFromElement', function () {
  it('should create content state', function () {
    var textNode = new _syntheticDom.TextNode('Hello World');
    var element = new _syntheticDom.ElementNode('div', [], [textNode]);
    var contentState = (0, _stateFromElement2.default)(element);
    var rawContentState = removeBlockKeys((0, _draftJs.convertToRaw)(contentState));
    (0, _expect2.default)(rawContentState).toEqual({ entityMap: {}, blocks: [{ text: 'Hello World', type: 'unstyled', depth: 0, inlineStyleRanges: [], entityRanges: [] }] });
  });

  it('supports custom element styles option', function () {
    var textNode = new _syntheticDom.TextNode('Superscript');
    var element = new _syntheticDom.ElementNode('sup', [], [textNode]);
    var wrapperElement = new _syntheticDom.ElementNode('div', [], [element]);
    var options = {
      elementStyles: {
        sup: 'SUPERSCRIPT'
      }
    };
    var contentState = (0, _stateFromElement2.default)(wrapperElement, options);
    var rawContentState = removeBlockKeys((0, _draftJs.convertToRaw)(contentState));
    (0, _expect2.default)(rawContentState).toEqual({ entityMap: {}, blocks: [{ text: 'Superscript', type: 'unstyled', depth: 0, inlineStyleRanges: [{ offset: 0, length: 11, style: 'SUPERSCRIPT' }], entityRanges: [] }] });
  });

  it('supports custom style option', function () {
    var textNode = new _syntheticDom.TextNode('text');
    var element = new _syntheticDom.ElementNode('span', [['style', 'color: red;']], [textNode]);
    element.attributes.style = { value: element.attributes.get('style') }; // make the style attribute DOM like
    var wrapperElement = new _syntheticDom.ElementNode('div', [], [element]);
    var options = {
      customStyleMap: {
        RED: { color: 'red' }
      }
    };
    var contentState = (0, _stateFromElement2.default)(wrapperElement, options);
    var rawContentState = removeBlockKeys((0, _draftJs.convertToRaw)(contentState));
    (0, _expect2.default)(rawContentState).toEqual({ entityMap: {}, blocks: [{ text: 'text', type: 'unstyled', depth: 0, inlineStyleRanges: [{ offset: 0, length: 4, style: 'RED' }], entityRanges: [] }] });
  });
});

describe('stateFromHTML', function () {
  testCases.forEach(function (testCase) {
    var description = testCase.description;
    var state = testCase.state;
    var html = testCase.html;

    it('should render ' + description, function () {
      var element = parseHTML(html);
      var actualState = removeBlockKeys((0, _draftJs.convertToRaw)((0, _stateFromElement2.default)(element)));
      (0, _expect2.default)(actualState).toEqual(state);
    });
  });
});

function parseHTML(html) {
  document.documentElement.innerHTML = html;
  var body = document.body;
  return body;
}

function removeBlockKeys(content) {
  var newContent = _extends({}, content);
  newContent.blocks = content.blocks.map(function (block) {
    var key = block.key;

    var other = _objectWithoutProperties(block, ['key']); // eslint-disable-line no-unused-vars


    return other;
  });
  return newContent;
}