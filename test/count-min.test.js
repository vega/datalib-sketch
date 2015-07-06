'use strict';

var assert = require('chai').assert;
var CountMin = require('../src/count-min');
var EPSILON = 0.1;
var width = 1021;
var depth = 3;

describe('count-min sketch', function() {
  var set1 = 'abcdefghij'.split('');
  var set2 = 'klmnopqrst'.split('');
  var set3 = '0123456789'.split('');

  it('should support constructors', function() {
    var n = 100,
        e = 0.001,
        p = 0.001,
        w = Math.ceil(n * Math.E / e),
        d = Math.ceil(-Math.log(p)), cm1;

    cm1 = CountMin.create();
    assert.equal(cm1._w, Math.ceil(Math.E / e));
    assert.equal(cm1._d, d);

    cm1 = CountMin.create(n);
    assert.equal(cm1._w, Math.ceil(n * Math.E));
    assert.equal(cm1._d, d);

    cm1 = CountMin.create(n, e);
    assert.equal(cm1._w, w);
    assert.equal(cm1._d, d);

    cm1 = CountMin.create(n, e, p);
    assert.equal(cm1._w, w);
    assert.equal(cm1._d, d);

    cm1 = new CountMin();
    assert.isAbove(cm1._w, 0);
    assert.isAbove(cm1._d, 0);
  });

  it('should approximately model counts', function() {
    var cm = new CountMin(width, depth);

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

  it('should estimate dot product', function() {
    var cm1 = new CountMin(width, depth);
    var cm2 = new CountMin(width, depth);
    var cm3 = new CountMin(width, depth);

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

    assert.throws(function() { cm1.dot(new CountMin(width+1, depth)); });
    assert.throws(function() { cm1.dot(new CountMin(width, depth+1)); });
  });

  it('should serialize and deserialize', function() {
    var cm1 = new CountMin(width, depth);
    set1.forEach(function(d) { cm1.add(d); });
    var json = JSON.stringify(cm1.export());
    var cm2 = CountMin.import(JSON.parse(json));
    assert.deepEqual(cm1.export(), cm2.export());
  });

});
