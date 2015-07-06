'use strict';

var assert = require('chai').assert;
var CountMeanMin = require('../src/count-mean-min');
var EPSILON = 0.1;
var width = 1021;
var depth = 3;

describe('count-mean-min sketch', function() {
  var set1 = 'abcdefghij'.split('');
  var set2 = 'klmnopqrst'.split('');
  var set3 = '0123456789'.split('');

  it('should approximately model counts', function() {
    var cm = new CountMeanMin(width, depth+1);

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

    cm = new CountMeanMin(2, 1);
    cm.add('a');
    cm._num = 0; // fudge internal count to force test coverage
    assert.equal(cm.query('a'), 1);
  });

  it('should estimate dot product', function() {
    var cm1 = new CountMeanMin(width, depth);
    var cm2 = new CountMeanMin(width, depth);
    var cm3 = new CountMeanMin(width, depth);

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

    assert.throws(function() { cm1.dot(new CountMeanMin(width+1, depth)); });
    assert.throws(function() { cm1.dot(new CountMeanMin(width, depth+1)); });
  });

  it('should serialize and deserialize', function() {
    var cm1 = new CountMeanMin(width, depth);
    set1.forEach(function(d) { cm1.add(d); });
    var json = JSON.stringify(cm1.export());
    var cm2 = CountMeanMin.import(JSON.parse(json));
    assert.deepEqual(cm1.export(), cm2.export());
  });

});
