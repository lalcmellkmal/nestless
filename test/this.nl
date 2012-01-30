var assert = require('assert'),
    common = require('./common');

function BusterMachine(singularity) {
	this.singularity = singularity;
}

var BM = BusterMachine.prototype;

BM.split = function (cb) {
	msg <- common.read(null);
	_ <- common.read();
	return {msg: msg, origami: this.singularity};
};

var BM19 = new BusterMachine('lark');
BM19.split(function (err, msg) {
	assert.ifError(err);
	assert.equal(msg.msg, common.message);
	assert.equal(msg.origami, 'lark');
});
