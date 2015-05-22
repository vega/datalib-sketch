'use strict';

var assert = require('chai').assert;
var CountMin = require('../src/countmin');
var EPSILON = 0.1;

describe('count-min sketch', function() {
  var set1 = 'abcdefghij'.split('');
  var set2 = 'klmnopqrst'.split('');
  var set3 = '0123456789'.split('');

  function hitsum(cm) {
    return function(sum, d) { return sum + cm.query(d); };
  }

  it('should approximately model counts', function() {
    var cm = new CountMin(1021, 3);
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

  it('should dot product', function() {
    var cm1 = new CountMin(1021, 3);
    var cm2 = new CountMin(1021, 3);
    var cm3 = new CountMin(1021, 3);
    set1.forEach(function(d) { cm1.add(d); cm2.add(d); });
    set2.forEach(function(d) { cm2.add(d); });
    set3.forEach(function(d) { cm3.add(d); });
    assert.equal(10, cm1._num);
    assert.equal(20, cm2._num);
    assert.equal(10, cm3._num);

    assert.closeTo( 0, cm1.dot(cm3), 10*EPSILON);
    assert.closeTo(10, cm1.dot(cm1), 10*EPSILON);
    assert.closeTo(20, cm2.dot(cm2), 10*EPSILON);
    assert.closeTo(10, cm1.dot(cm2), 10*EPSILON);
  });

});

function nonzero(t) {
  var n = t.length, i, a = [];
  for (i=0; i<n; ++i) {
    if (t[i] > 0) a.push(i);
  }
  return a;
}