'use strict';

var _expect = require('expect');

var _expect2 = _interopRequireDefault(_expect);

var _replaceTextWithMeta = require('../replaceTextWithMeta');

var _replaceTextWithMeta2 = _interopRequireDefault(_replaceTextWithMeta);

var _immutable = require('immutable');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var _global = global;
var describe = _global.describe;
var it = _global.it;


describe('replaceTextWithMeta', function () {
  var none = 'NONE';
  var bold = 'BOLD';

  it('should handle empty source', function () {
    var result = (0, _replaceTextWithMeta2.default)({ text: '', characterMeta: _immutable.Seq.of() }, 'a', 'b');
    (0, _expect2.default)(result.text).toBe('');
    (0, _expect2.default)(result.characterMeta.toArray()).toEqual([]);
  });

  it('should handle not found', function () {
    var result = (0, _replaceTextWithMeta2.default)({ text: 'abc', characterMeta: _immutable.Seq.of(bold, bold, bold) }, 'd', 'e');
    (0, _expect2.default)(result.text).toBe('abc');
    (0, _expect2.default)(result.characterMeta.toArray()).toEqual([bold, bold, bold]);
  });

  it('should handle one occurance', function () {
    var result = (0, _replaceTextWithMeta2.default)({ text: 'abc', characterMeta: _immutable.Seq.of(none, bold, none) }, 'b', 'xx');
    (0, _expect2.default)(result.text).toBe('axxc');
    (0, _expect2.default)(result.characterMeta.toArray()).toEqual([none, bold, bold, none]);
  });

  it('should handle multiple occurances', function () {
    var result = (0, _replaceTextWithMeta2.default)({ text: 'abcba', characterMeta: _immutable.Seq.of(none, bold, none, none, none) }, 'b', 'xx');
    (0, _expect2.default)(result.text).toBe('axxcxxa');
    (0, _expect2.default)(result.characterMeta.toArray()).toEqual([none, bold, bold, none, none, none, none]);
  });
});