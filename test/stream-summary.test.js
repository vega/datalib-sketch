'use strict';

var assert = require('chai').assert;
var StreamSummary = require('../src/stream-summary');

describe('stream-summary', function() {

  it('should calculate top-k items', function() {
    var ss = new StreamSummary(3);
    ss.add(1);
    assert.equal(ss.query(1), 1);

    ss.add(2);
    assert.equal(ss.query(1), 1);
    assert.equal(ss.query(2), 1);

    ss.add(2);
    assert.equal(ss.query(1), 1);
    assert.equal(ss.query(2), 2);

    ss.add(2);
    assert.equal(ss.query(1), 1);
    assert.equal(ss.query(2), 3);

    ss.add(3);
    assert.equal(ss.query(1), 1);
    assert.equal(ss.query(2), 3);
    assert.equal(ss.query(3), 1);

    ss.add(1);
    assert.equal(ss.query(1), 2);
    assert.equal(ss.query(2), 3);
    assert.equal(ss.query(3), 1);

    ss.add(1);
    assert.equal(ss.query(1), 3);
    assert.equal(ss.query(2), 3);
    assert.equal(ss.query(3), 1);

    ss.add(4);
    assert.equal(ss.query(1), 3);
    assert.equal(ss.query(2), 3);
    assert.equal(ss.query(3), 0);
    assert.equal(ss.query(4), 2);

    assert.equal(ss.error(1), 0);
    assert.equal(ss.error(2), 0);
    assert.equal(ss.error(3),-1);
    assert.equal(ss.error(4), 1);

    assert.deepEqual(ss.values(), [2, 1, 4]);
    assert.deepEqual(ss.counts(), [3, 3, 2]);
    assert.deepEqual(ss.errors(), [0, 0, 1]);
    assert.deepEqual(ss.values(2), [2, 1]);
    assert.deepEqual(ss.counts(2), [3, 3]);
    assert.deepEqual(ss.errors(2), [0, 0]);

    ss.add(4, 4);
    assert.equal(ss.query(4), 6);

    ss = new StreamSummary();
    assert.deepEqual(ss.counts(), []);
    assert.deepEqual(ss.counts(0), []);
  });

  it('should serialize and deserialize', function() {
    var ss1 = new StreamSummary();
    [1,2,2,2,3,1,1,4].forEach(function(d) { ss1.add(d); });
    var json = JSON.stringify(ss1.export());
    var ss2 = StreamSummary.import(JSON.parse(json));
    assert.deepEqual(ss1.export(), ss2.export());
  });

});
