'use strict';

var assert = require('chai').assert;
var CountMeanMin = require('../src/countmeanmin');
var EPSILON = 0.1;

describe('count-mean-min sketch', function() {
  var set1 = 'abcdefghij'.split('');
  var set2 = 'klmnopqrst'.split('');
  var set3 = '0123456789'.split('');

  it('should approximately model counts', function() {
    var cm = new CountMeanMin(1024, 3);
    set1.forEach(function(d) { cm.add(d); });
    set1.forEach(function(d) { cm.add(d); });
    set2.forEach(function(d) { cm.add(d); });
    assert.equal(30, cm._num);

    set1.forEach(function(d) {
      assert.closeTo(2, cm.query(d), EPSILON);
    });
    set2.forEach(function(d) {
      assert.closeTo(1, cm.query(d), EPSILON);
    });
    set3.forEach(function(d) {
      assert.closeTo(0, cm.query(d), EPSILON);
    });
  });

});
