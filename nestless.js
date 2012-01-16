#!/usr/bin/env node
var fs = require('fs'),
    parser = require('./parser'),
    util = require('util');

// Global constants
require('./jsdefs');
var tokenIds = Narcissus.definitions.tokenIds;
eval(Narcissus.definitions.consts);
const CALLBACK_RE = /c(?:all)?b(?:ack)?/i;

var OPTS = {};

/* ANALYSIS */

function analysis() {

var stack = [];
var defers = {};
var blockCtr = 0;

function analyzeFunc(node) {
	var block = newBlock(null);
	block.funcEntry = true;
	node.entryBlock = block;
	var script = node.body;
	if (script.type == GENERATOR)
		script = script.body;
	if (script.type != SCRIPT)
		throw new Nope("Unexpected function form", node);

	// Capture function exit blocks
	var level = stack[0].level;
	var oldDefers = defers[level];
	delete defers[level];
	analyzeStmts(script.children, block);
	var funcExits = defers[level];
	if (funcExits) {
		node.exitBlocks = funcExits;
		funcExits.forEach(function (exitBlock) {
			exitBlock.funcExit = true;
		});
	}
	if (oldDefers)
		defers[level] = oldDefers;
	else
		delete defers[level];
}

var analyzer = {
	expr: expr,
	func: analyzeFunc,
	yieldExpr: function (node) {},
};

function newBlock(entry) {
	var block = {exits: [], entrances: [], index: blockCtr++};
	if (entry)
		addExit(entry, block);
	return block;
}

function analyzeBlock(node, block) {
	if (node.type == BLOCK)
		analyzeStmts(node.children, block);
	else if (node instanceof Array)
		analyzeStmts(node, block);
	else {
		block.braceless = true;
		analyzeStmts([node], block);
	}
}

function analyzeStmt(node) {
	var entryBlock = stack[0];
	var stmt = analyzeStmt;
	switch (node.type) {
	case BLOCK:
		entryBlock.over = true;
		analyzeBlock(node, newBlock(entryBlock));
		break;
	case IF:
		entryBlock.over = true;
		analyzeBlock(node.thenPart, newBlock(entryBlock));
		if (node.elsePart)
			analyzeBlock(node.elsePart, newBlock(entryBlock));
		else
			deferExit(entryBlock.level, entryBlock);
		break;
	case DO:
	case FOR:
	case WHILE:
		// ignore conditions etc.
		// Not even bothering with loop analysis... out of scope for this project
		entryBlock.over = true;
		analyzeBlock(node.body, newBlock(entryBlock));
		break;
	case SWITCH:
		entryBlock.over = true;
		// OH GOD what about breaks
		node.cases.forEach(function (casa) {
			analyzeBlock(casa.statements, newBlock(entryBlock));
		});
		break;
	case TRY:
		// This is not correct.
		entryBlock.over = true;
		var tryBlock = newBlock(entryBlock);
		analyzeBlock(node.tryBlock, tryBlock);
		node.catchClauses.forEach(function (clause) {
			analyzeBlock(clause.block, newBlock(tryBlock));
		});
		var finallyBlock = newBlock(entryBlock);
		if (node.finallyBlock)
			analyzeBlock(node.finallyBlock, finallyBlock);
		else
			analyzeBlock([], finallyBlock);
		break;
	case FUNCTION:
		analyzeFunc(node);
		break;
	case BREAK:
	case CONTINUE:
		break;
	case RETURN:
		if (node.children.length)
			analyzer.expr(node.children[0]);
		break;
	case SEMICOLON:
		if (!splitArrow(node))
			analyzer.expr(node.expression);
		break;
	case THROW:
		break;
	case VAR:
		node.children.forEach(function (decl) {
			if (decl.initializer)
				analyzer.expr(decl.initializer);
		});
		break;
	default:
		console.error(node);
		throw new Nope('Unexpected ' + nodeType(node), node);
	}
}

function analyzeStmts(nodes, block) {
	if (!block)
		throw new Nope("Block required", nodes.length ? nodes[0] : null);
	// new scope
	var prevLevel = stack[0] ? stack[0].level : 0;
	var thisLevel = prevLevel + 1;
	block.level = thisLevel;
	stack.unshift(block);

	var len = nodes.length;
	for (var i = 0; i < len; i++) {
		if (block.over)
			stack[0] = block = newBlock(null);

		// Since this is a real block, any defered exits should go here
		if (thisLevel in defers) {
			defers[thisLevel].forEach(function (oldBlock) {
				addExit(oldBlock, block);
			});
			delete defers[thisLevel];
		}

		// Do this stmt
		var node = nodes[i];
		node.astBlock = block;
		block.hasStmts = true;
		analyzeStmt(nodes[i]);
	}
	// scope is over
	blocksNeedingExit(block).forEach(function (src) {
		deferExit(prevLevel, src);
	});
	// let dangling exits pass-through to outer scope
	if (thisLevel in defers) {
		defers[thisLevel].forEach(function (block) {
			deferExit(prevLevel, block);
		});
		delete defers[thisLevel];
	}
	stack.shift();
}

function deferExit(toLevel, block) {
	if (!(toLevel in defers))
		defers[toLevel] = [];
	defers[toLevel].push(block);
}

function addExit(fromBlock, toBlock) {
	fromBlock.exits.push(toBlock);
	toBlock.entrances.push(fromBlock);
}

function blocksNeedingExit(block) {
	if (block.over)
		return [];
	var found = [];
	var wanting = [block];
	while (wanting.length) {
		var nextGen = [];
		wanting.forEach(function (block) {
			if (block.hasStmts)
				return found.push(block);
			if (block.funcEntry)
				return;
			nextGen = nextGen.concat(block.entrances);
		});
		wanting = nextGen;
	}
	return found;
}

function analyzeScript(nodes) {
	analyzeStmts(nodes, newBlock(null));
}

return analyzeScript;
}

/* MUTATION */

function mutation() {

var stack = [];
var replacements = {};
var insertions = {};

function replace(start, end, str) {
	if (!start)
		throw new Nope("Invalid start", start, end);
	if (end < start)
		throw new Nope("Replacement would back up");
	if (start in replacements)
		throw new Nope("Replacement exists", start, end);
	replacements[start] = {end: end, str: str};
}

function insert(pos, str) {
	if (!pos)
		throw new Nope("Invalid insertion pos " + pos);
	var old = insertions[pos];
	if (old)
		old.push(str);
	else
		insertions[pos] = [str];
}

function close(str) {
	stack[0].closes.unshift(str);
}

function block(node, extra) {
	if (node.type != BLOCK)
		throw new Nope("That's no block!", node);
	var prev = stack[0] || {level: 0};
	var scope = {level: prev.level+1, closes: [], callback: prev.callback};
	['canYield', 'canThrow', 'canBreakContinue'].forEach(function (inherit) {
		scope[inherit] = prev[inherit];
	});
	if (extra)
		for (var k in extra)
			scope[k] = extra[k];

	stack.unshift(scope);
	stmts(node.children);
	if (stack.shift() !== scope)
		throw new Nope("Imbalanced block?!", node);

	var end = node.realEnd - 1;
	if (scope.returnAfter)
		insert(end, 'return; ');
	if (scope.closes.length)
		insert(end, scope.closes.join(''));
}

function mutateFunc(node) {
	var prev = stack[0] || {level: 0};
	var scope = {level: prev.level+1, closes: []};
	stack.unshift(scope);

	var params = node.params;
	if (params && params.length) {
		var lastParam = params[params.length-1];
		if (lastParam.match(CALLBACK_RE))
			scope.callback = lastParam;
	}
	var script = node.body;
	if (script.type == GENERATOR)
		script = script.body;
	stmts(script.children);
	if (stack.shift() !== scope)
		throw new Nope("Imbalanced block?!", node);
	if (scope.closes.length)
		insert(node.end-1, scope.closes.join(''));
}

var mutator = {
	expr: expr,
	func: mutateFunc,
	yieldExpr: function yieldExpr(node) {
		if (!stack.length)
			throw new Nope("Can't yield in global scope", node);
		var scope = stack[0];
		if (scope.callback && scope.canYield) {
			replace(node.start, node.start+6, scope.callback+'(null, ');
			insert(node.value.end, ')');
		}
		else
			throw new Nope("Can't yield in non-bound scope", node);
	},
};

function stmt(node) {
	var scope = stack[0];

	if (OPTS.debug)
		dumpBlock(node);

	switch (node.type) {
	case BLOCK:
		block(node);
		break;
	case IF:
		stmt(node.thenPart);
		if (node.elsePart)
			stmt(node.elsePart);
		break;
	case DO:
	case FOR:
	case WHILE:
		if (node.body.type == BLOCK)
			block(node.body, {canBreakContinue: true});
		else
			stmt(node.body);
		break;
	case SWITCH:
		node.cases.forEach(function (casa) {
			block(casa.statements, {canBreakContinue: true, cannotBind: true});
		});
		break;
	case TRY:
		block(node.tryBlock, {canThrow: false});
		node.catchClauses.forEach(function (clause) {
			block(clause.block);
		});
		if (node.finallyBlock)
			block(node.finallyBlock);
		break;

	case FUNCTION:
		mutateFunc(node);
		break;

	case BREAK:
	case CONTINUE:
		if (!scope.canBreakContinue)
			throw new Nope("Can't " + (node.type == BREAK ? "break" : "continue") + " after binding", node);
		break;

	case RETURN:
		if (node.children.length)
			mutator.expr(node.children[0]);
		if (!stack.length)
			throw new Nope("Can't return in global scope", node);
		if (scope.callback && scope.canYield) {
			replace(node.start, node.start+7, 'return '+scope.callback+'(null, ');
			insert(node.value.end, ')');
			scope.returnAfter = true;
		}
		break;

	case SEMICOLON:
		var arrow = splitArrow(node);
		if (!arrow) {
			mutator.expr(node.expression);
			break;
		}
		if (!stack.length)
			throw new Nope("Can't bind in global scope; please wrap in {}s", node);
		if (scope.cannotBind)
			throw new Nope("Can't bind in a switch; please wrap in {}s", node);
		var cb = scope.callback;
		if (!cb)
			throw new Nope("Can't bind inside a function without a callback parameter", node);
		scope.canYield = true;
		scope.canThrow = true;
		scope.canBreakContinue = false;
		replace(node.start, arrow.rhs.start, '');
		var err = 'err';
		arrow.params.unshift(err);
		var newCall = 'function (' + arrow.params.join(', ') + ') { if ('+err+') return '+cb+'('+err;
		if (arrow.argList.children.length > 0)
			newCall = ', ' + newCall;
		replace(arrow.argList.end, node.end, newCall);
		close('}); ');
		break;
	case THROW:
		if (!stack.length)
			break;
		var scope = stack[0];
		if (scope.callback && stack.canThrow) {
			replace(node.start, node.start+6, 'return '+scope.callback+'(');
			insert(node.exception.end, ')');
		}
		break;
	case VAR:
		node.children.forEach(function (decl) {
			if (decl.initializer)
				mutator.expr(decl.initializer);
		});
		break;
	default:
		console.error(node);
		throw new Nope('Unexpected ' + nodeType(node), node);
	}
}

function stmts(nodes) {
	var scope = stack[0];
	for (var i = 0; i < nodes.length; i++) {
		var node = nodes[i];
		if (scope.dead)
			insert(node.start, '/* DEAD */ ');
		stmt(node);
		if (scope.returnAfter && i < nodes.length - 1) {
			scope.returnAfter = false;
			scope.dead = true;
		}
	}
}

function dumpBlock(node) {
	if (node.type == BLOCK || stack.length < 2)
		return;
	var out = 'has no block';
	var block = node.astBlock;
	if (block) {
		out = 'block ' + block.index;
		if (block.funcEntry)
			out = 'entry ' + out;
		if (block.exits.length) {
			var exits = block.exits.map(function (x) {
				return '' + x.index;
			});
			out += ' -> ' + exits.join(', ');
		}
		if (block.funcExit)
			out += ' exit';
	}
	insert(node.start, '/* ' + out + ' */ ');
}

return {stmt: stmt, replacements: replacements, insertions: insertions};
}

/* OUTPUT */

function dumpPoints(results, src) {
	var prev = 0;
	results.points.forEach(function (p) {
		var color = require('ansi-color');
		var width = 60, context = 10;
		var ins = results.insertions[p];
		var repl = results.replacements[p];
		var end = repl ? repl.end : p;
		var result = '';
		var action = "inserting"
		var before = " ..." + src.substring(p-context, p).replace(/\s/g, ' ') + '`';
		var after = "`" + src.substring(end, end+context).replace(/\s/g, ' ') + "...";
		var quote, rhs = '', quoteColor = 'green';
		if (repl) {
			quote = src.substring(p, end);
			var result = repl.str;
			if (ins)
				result = ins.join('') + result;
			if (result) {
				quoteColor = 'yellow';
				action = 'replacing';
				var space = Math.max(0, width - action.length - before.length - quote.length - after.length - 2);
				rhs = Array(space+1).join(' ') + "-> '" + color.set(result, quoteColor) + "'";
			}
			else {
				quoteColor = 'red';
				action = ' deleting';
			}
		}
		else
			quote = color.set(ins.join(''), 'green');
		if (p < prev)
			rhs += color.set(' SKIPPED', 'red');
		console.error(color.set(action, quoteColor) + before + color.set(quote, quoteColor) + after + rhs);
		prev = end;
	});
}

function emit(src, results, out) {
	var replacements = results.replacements, insertions = results.insertions;
	// Build a list of all insertion/replacement indices
	var points = Object.keys(replacements).map(function (x) {
		return parseInt(x, 10);
	});
	for (var x in insertions)
		if (!(x in replacements))
			points.push(parseInt(x, 10));
	points.sort(function (b, a) { return b - a; });

	if (OPTS.verbose) {
		results.points = points;
		dumpPoints(results, src);
	}

	out = out ? fs.createWriteStream(out) : process.stdout;
	var pos = 0;
	while (pos < src.length) {
		var next = points.length ? points.shift() : src.length;
		while (next < pos) {
			var repl = replacements[next];
			if (repl)
				throw new Error("Replacement >>>" + repl.str + "<<< was overwritten by another replacement");
			var ins = insertions[next];
			if (ins)
				throw new Error("Insertion >>>" + ins.join('') + "<<< was overwritten by another replacement");
			next = points.length ? points.shift() : src.length;
		}
		out.write(src.substring(pos, next));
		pos = next;
		if (next >= src.length)
			break;
		var ins = insertions[pos];
		if (ins)
			out.write(ins.join(''));
		var repl = replacements[pos];
		if (repl) {
			out.write(repl.str);
			pos = repl.end;
		}
	}
}

/* HELPERS */

function nodeType(node) {
	var type = node.type;
	for (var name in tokenIds)
		if (tokenIds[name] === type)
			return name;
	return '<unknown node type>';
}

// Generic expression walker
function expr(node) {
	var thisExpr = expr.bind(this);
	switch (node.type) {
	case OBJECT_INIT:
		if (node.children.length == 0)
			break;
		node.children.forEach(function (propInit) {
			propInit.children.forEach(thisExpr);
		});
		break;

	case AND:
	case ARRAY_INIT:
	case ASSIGN:
	case CALL:
	case DOT:
	case INDEX:
	case HOOK:
	case LIST:
	case NEW:
	case NEW_WITH_ARGS:
	case OR:
		node.children.forEach(thisExpr);
		break;

	case DELETE:
	case IDENTIFIER:
	case NULL:
	case NUMBER:
	case REGEXP:
	case STRING:
		break;

	case FUNCTION:
		this.func(node);
		break;

	case YIELD:
		this.yieldExpr(node);
		break;

	default:
		console.error(nodeType(node));
		console.error(node);
		node.children.forEach(thisExpr);
		break;
	}
}

function splitArrow(node) {
	var arrow = node.expression;
	var params = [];
	var validTuple = true;
	while (arrow.type == COMMA) {
		var ident = arrow.children[0];
		if (!ident || ident.type != IDENTIFIER) {
			valid = false;
			break;
		}
		params.push(ident.value);
		arrow = arrow.children[1];
	}
	if (arrow.type != LT)
		return false;
	if (!validTuple)
		throw new Nope('Identifiers(s) expected in tuple before arrow', ident);
	var minus = arrow.children[1];
	if (minus.type != UNARY_MINUS)
		throw new Nope('Incomplete arrow', arrow);
	var ident = arrow.children[0];
	if (ident.type != IDENTIFIER)
		throw new Nope('Identifier(s) expected before arrow', arrow);
	params.push(ident.value);
	var rhs = arrow.children[1].children[0];
	if (rhs.type != CALL)
		throw new Nope('Call expected after arrow', arrow);
	var argList = rhs.children[1];
	if (rhs.children.length != 2 || argList.type != LIST)
		throw new Nope('Unexpected call format', rhs);
	return {rhs: rhs, argList: argList, params: params};
}

function Nope(message, node, end) {
	Error.call(this, message);
	Error.captureStackTrace(this, this.constructor);
	this.message = message;
	this.node = (node instanceof Number) ? {start: node, end: end} : node;
}
util.inherits(Nope, Error);

/* MAIN */

function flatten(src, filename, outputFilename) {
	var root = parser.parse(src, filename);
	/* clear out the damn tokenizer for debugging */
	for (var k in root.tokenizer)
		delete root.tokenizer[k];

	var results;
	try {
		var analyzeStmts = analysis();
		analyzeStmts(root.children);

		results = mutation();
		var mutateStmt = results.stmt;
		// Avoid creating a global scope
		root.children.forEach(mutateStmt);
	}
	catch (e) {
		if (!(e instanceof Nope))
			throw e;
		if (e.node) {
			var node = e.node;
			var frag = "<unknown fragment>";
			if (node.start && node.end)
				frag = ">>>" + src.substring(node.start, node.end) + "<<<";
			var loc = filename + ":" + (node.lineno || "") + ": ";
			console.error(loc + frag);
		}
		throw e;
	}

	emit(src, results, outputFilename);
}
exports.flatten = flatten;

if (require.main === module) {
	var args = process.argv.slice(2);
	var targets = [];
	var outputFilename;
	try {
		while (args.length) {
			var arg = args.shift();
			if (!arg)
				continue;
			if (arg[0] != '-') {
				targets.push(arg);
				continue;
			}
			if (arg == '--') {
				targets = targets.concat(args);
				break;
			}
			else if (['-v', '--verbose'].indexOf(arg) >= 0)
				OPTS.verbose = true;
			else if (['-g', '--debug'].indexOf(arg) >= 0)
				OPTS.debug = true;
			else if (arg == '-o') {
				if (outputFilename)
					throw new Error("Multiple output filenames specified.");
				outputFilename = args.shift();
				if (!outputFilename)
					throw new Error("Output filename required.");
			}
			else
				throw new Error("Invalid argument: " + arg);
		}
		if (targets.length > 1 && outputFilename)
			throw new Error("Can't specify an output filename with multiple inputs.");
	}
	catch (e) {
		console.error(e.message);
		process.exit(-1);
	}
	if (targets.length) {
		targets.forEach(function (filename) {
			var dest = outputFilename;
			if (!dest) {
				var m = filename.match(/^(.*)\.nl$/);
				dest = (m ? m[1] : filename) + '.js';
			}
			var src = fs.readFileSync(filename, 'UTF-8');
			flatten(src, filename, dest);
		});
	}
	else {
		process.stdin.resume();
		// Buffer stdin
		var bufs = [];
		var len = 0;
		process.stdin.on('data', function (data) {
			bufs.push(data);
			len += data.length;
		});
		process.stdin.on('end', function () {
			var dest = new Buffer(len);
			var pos = 0;
			bufs.forEach(function (buf) {
				buf.copy(dest, pos);
				pos += buf.length;
			});
			var src = dest.toString('UTF-8');
			flatten(src, '<stdin>', outputFilename);
		});
	}
}
