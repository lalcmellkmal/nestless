"use strict";

var common = require('./common');

function go(cb) {
	guts <- common.read();
	return guts;
}

go(function (err, guts) {
	var assert = require('assert');
	assert.ifError(err);
	assert.equal(guts, common.message);
});
