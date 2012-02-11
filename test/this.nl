var assert = require('assert'),
    common = require('./common');

function BusterMachine(singularity) {
	this.singularity = singularity;
}

var BM = BusterMachine.prototype;

BM.split = function (cb) {
	msg <- common.read();
	_ <- common.read();
	return {msg: msg, origami: this.singularity};
};

BM.read = function (cb) {
	msg <- common.read();
	return msg;
};

BM.origami = function (cb) {
	_ <- common.read();
	msg <- this.read();
	return msg;
};

var BM19 = new BusterMachine('lark');
BM19.split(function (err, msg) {
	assert.ifError(err);
	assert.equal(msg.msg, common.message);
	assert.equal(msg.origami, 'lark');
	BM19.origami(function (err, msg2) {
		assert.ifError(err);
		assert.equal(msg2, common.message);
	});
});
