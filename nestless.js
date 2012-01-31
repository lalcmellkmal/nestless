#!/usr/bin/env node
var fs = require('fs'),
    parser = require('./narcissus/parser'),
    util = require('util');

// Global constants
require('./narcissus/jsdefs');
var tokenIds = Narcissus.definitions.tokenIds;
eval(Narcissus.definitions.consts);
const CALLBACK_RE = /c(?:all)?b(?:ack)?/i;
const FUNC_BIND_PREFIX = '(';
const FUNC_BIND_SUFFIX = '}).bind(this)); ';

var OPTS = {verbose: false, debug: false};
exports.options = OPTS;

/* ANALYSIS */

function analysis() {

var stack = [];
var defers = {};
var blockCtr = 0;
var curLevel = 0;
var escapeLevels = [];
var curFunc = null;

function analyzeFunc(node) {
	var outerFunc = curFunc;
	curFunc = node;

	var block = newBlock(null);
	block.funcEntry = true;
	node.entryBlock = block;
	var script = node.body;
	if (script.type == GENERATOR)
		script = script.body;
	if (script.type != SCRIPT)
		throw new Bug("Unexpected function form", node);

	// Capture function exit blocks
	var level = curLevel;
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

	curFunc = outerFunc;
}

function analyzeExpr(node) {
	switch (node.type) {
	case OBJECT_INIT:
		node.children.forEach(function (propInit) {
			propInit.children.forEach(analyzeExpr);
		});
		break;

	case FUNCTION:
		analyzeFunc(node);
		break;

	case THIS:
		if (curFunc)
			curFunc.usesThis = true;
		break;

	default:
		node.children.forEach(analyzeExpr);
		break;
	}
}

function newBlock(entry) {
	var block = {exits: [], entrances: [], index: blockCtr++};
	if (entry)
		addExit(entry, block);
	return block;
}

function analyzeBlock(node, block) {
	if (node.type == BLOCK)
		return analyzeStmts(node.children, block);
	else if (node instanceof Array)
		return analyzeStmts(node, block);
	else {
		block.braceless = true;
		return analyzeStmts([node], block);
	}
}

function killsNext(block) {
	return block.dead || block.returns || block.breaks;
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
			deferExit(curLevel, entryBlock);
		break;
	case DO:
	case FOR:
	case FOR_IN:
	case WHILE:
		['setup', 'condition', 'update', 'varDecl', 'object'].forEach(function (k) {
			if (node[k])
				analyzeExpr(node[k]);
		});
		escapeLevels.unshift(curLevel);
		// Not even bothering with loop analysis... out of scope for this project
		entryBlock.over = true;
		analyzeBlock(node.body, newBlock(entryBlock));
		escapeLevels.shift();
		break;
	case SWITCH:
		var breakLevel = curLevel;
		var caseLevel = ++curLevel;
		escapeLevels.unshift(breakLevel);
		entryBlock.over = true;
		var exitBlock, fallThroughs = false;
		node.cases.forEach(function (casa) {
			var caseEntry = newBlock(entryBlock);
			if (fallThroughs) {
				fallThroughs.forEach(function (fall) {
					addExit(fall, caseEntry);
				});
			}
			analyzeBlock(casa.statements, caseEntry);
			fallThroughs = defers[caseLevel];
			if (fallThroughs)
				delete defers[caseLevel];
		});
		curLevel--;
		escapeLevels.shift();
		break;
	case TRY:
		// This will never be correct due to exception semantics
		// Shouldn't be using exceptions in an async function anyway
		entryBlock.over = true;
		var tryBlock = newBlock(entryBlock);
		analyzeBlock(node.tryBlock, tryBlock);
		node.catchClauses.forEach(function (clause) {
			analyzeBlock(clause.block, newBlock(tryBlock));
		});
		if (node.finallyBlock) {
			var finallyBlock = newBlock(tryBlock);
			consumeEachDefer(curLevel, function (block) {
				addExit(block, finallyBlock);
			});
			analyzeBlock(node.finallyBlock, finallyBlock);
		}
		break;
	case FUNCTION:
		analyzeFunc(node);
		break;
	case BREAK:
	case CONTINUE:
		// assuming switch
		entryBlock.over = entryBlock.breaks = true;
		deferExit(escapeLevels[0], entryBlock);
		break;
	case RETURN:
		entryBlock.over = entryBlock.returns = true;
		if (node.value)
			analyzeExpr(node.value);
		break;
	case SEMICOLON:
		if (!splitArrow(node))
			analyzeExpr(node.expression);
		break;
	case THROW:
		break;
	case VAR:
		node.children.forEach(function (decl) {
			if (decl.initializer)
				analyzeExpr(decl.initializer);
		});
		break;
	default:
		throw new Bug('Unexpected ' + nodeType(node), node);
	}
}

function analyzeStmts(nodes, block) {
	if (!block)
		throw new Bug("Block required", nodes.length ? nodes[0] : null);
	// new scope
	var prevBlock = stack[0] || {};
	var prevLevel = curLevel;
	var thisLevel = ++curLevel;
	if (killsNext(prevBlock))
		block.dead = true;
	stack.unshift(block);

	var len = nodes.length;
	for (var i = 0; i < len; i++) {
		if (block.over) {
			var dead = block.dead || block.returns;
			stack[0] = block = newBlock(null);
			if (dead)
				block.dead = true;
		}

		// Since this is a real block, any defered exits should go here
		consumeEachDefer(thisLevel, function (oldBlock) {
			addExit(oldBlock, block);
		});

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
	consumeEachDefer(thisLevel, function (block) {
		deferExit(prevLevel, block);
	});
	curLevel--;
	return stack.shift();
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

function consumeEachDefer(level, func) {
	if (level in defers) {
		defers[level].forEach(func);
		delete defers[level];
	}
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
		throw new Bug("Invalid start", start, end);
	if (end < start)
		throw new Bug("Replacement " + start + '..' + end + " would back up", end, start);
	if (start in replacements)
		throw new Bug("Replacement exists", start, end);
	if (str.indexOf('\n') >= 0)
		throw new Bug("Replacement >>>" + str + "<<< would insert newline", start, end);
	replacements[start] = {end: end, str: str};
}

function insert(pos, str) {
	if (!pos)
		throw new Bug("Invalid insertion pos " + pos);
	if (str.indexOf('\n') >= 0)
		throw new Bug("Insertion >>>" + str + "<<< would insert newline");
	var old = insertions[pos];
	if (old)
		old.push(str);
	else
		insertions[pos] = [str];
}

function close(str) {
	stack[0].closes.unshift(str);
}

var scopeInherited = ['canYield', 'canThrow', 'canEscape', 'usesThis'];

function block(node, extra) {
	if (node.type != BLOCK)
		throw new Bug("That's no block!", node);
	var prev = stack[0] || {level: 0};
	var scope = {level: prev.level+1, closes: [], callback: prev.callback};
	scopeInherited.forEach(function (inherit) {
		scope[inherit] = prev[inherit];
	});
	if (extra)
		for (var k in extra)
			scope[k] = extra[k];

	stack.unshift(scope);
	stmts(node.children);
	if (stack.shift() !== scope)
		throw new Bug("Imbalanced block?!", node);

	if (scope.returnAfter) {
		var skip = false, last = node.children[node.children.length - 1];
		if (last) {
			var block = last.astBlock;
			if (block && block.funcExit)
				skip = true;
		}
		if (!skip)
			scope.closes.push('return; ');
		else if (OPTS.debug)
			scope.closes.push('/* dup ret */ ');
	}
	if (scope.closes.length)
		insert(node.end-1, scope.closes.join(''));
}

function mutateFunc(node) {
	var prev = stack[0] || {level: 0};
	var scope = {level: prev.level+1, closes: []};
	if (node.usesThis)
		scope.usesThis = true;
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
		throw new Bug("Imbalanced block?!", node);
	if (scope.closes.length)
		insert(node.end-1, scope.closes.join(''));
}

function mutateExpr(node) {
	switch (node.type) {
	case OBJECT_INIT:
		node.children.forEach(function (propInit) {
			propInit.children.forEach(mutateExpr);
		});
		break;

	case FUNCTION:
		mutateFunc(node);
		break;

	case YIELD:
		if (!stack.length)
			throw new Nope("Can't yield in global scope", node);
		var scope = stack[0];
		if (scope.callback && scope.canYield) {
			replace(node.start, node.start+6, scope.callback+'(null, ');
			insert(node.value.end, ')');
		}
		else
			throw new Nope("Can't yield in non-bound scope", node);
		break;

	default:
		node.children.forEach(mutateExpr);
		break;
	}
}


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
	case FOR_IN:
	case WHILE:
		if (node.body.type == BLOCK)
			block(node.body, {canEscape: true});
		else
			stmt(node.body);
		break;
	case SWITCH:
		node.cases.forEach(function (casa) {
			block(casa.statements, {canEscape: true, cannotBind: true});
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
		if (!scope.canEscape)
			throw new Nope("Can't " + (node.type == BREAK ? "break" : "continue") + " after binding", node);
		break;

	case RETURN:
		if (!stack.length)
			throw new Nope("Can't return in global scope", node);
		if (node.value) {
			mutateExpr(node.value);
			if (scope.callback && scope.canYield) {
				replace(node.start, node.start+7, 'return '+scope.callback+'(null, ');
				insert(node.value.end, ')');
				scope.returnAfter = true;
			}
		}
		break;

	case SEMICOLON:
		var arrow = splitArrow(node);
		if (!arrow) {
			mutateExpr(node.expression);
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
		scope.canEscape = false;
		replace(node.start, arrow.rhs.start, '');
		var err = 'err', params = filterUnderscores(arrow.params);
		params.unshift(err);
		var newCall = 'function (' + params.join(', ') + ') { if ('+err+') return '+cb+'('+err;
		var captureThis = scope.usesThis;
		if (captureThis)
			newCall = FUNC_BIND_PREFIX + newCall;
		if (arrow.argList.children.length > 0)
			newCall = ', ' + newCall;
		replace(arrow.argList.end, node.end, newCall);
		close(captureThis ? FUNC_BIND_SUFFIX : '}); ');
		break;
	case THROW:
		if (!stack.length)
			break;
		if (scope.callback && scope.canThrow) {
			replace(node.start, node.start+6, 'return '+scope.callback+'(');
			insert(node.exception.end, ')');
			scope.returnAfter = true;
		}
		break;
	case VAR:
		node.children.forEach(function (decl) {
			if (decl.initializer)
				mutateExpr(decl.initializer);
		});
		break;
	default:
		throw new Bug('Unexpected ' + nodeType(node), node);
	}
}

function stmts(nodes) {
	var scope = stack[0];
	for (var i = 0; i < nodes.length; i++) {
		var node = nodes[i];
		if (node.astBlock && node.astBlock.dead)
			insert(node.start, '/* DEAD */ ');
		stmt(node);
	}
}

function dumpBlock(node) {
	if (!stack.length)
		return;
	var out = 'has no block';
	var block = node.astBlock;
	if (block) {
		out = 'block ' + block.index;
		if (block.usesThis)
			out = '@' + out;
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
		else if (block.returns)
			out += ' ret';
	}
	insert(node.start, '/* ' + out + ' */ ');
}

return {stmt: stmt, replacements: replacements, insertions: insertions};
}

/* OUTPUT */

function dumpPoints(results, src) {
	var prev = 0, color;
	try {
		color = require('ansi-color');
	}
	catch (e) {
		color = {set: function (s, c) { return s; }};
	}
	results.points.forEach(function (p) {
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
			var removed = src.substring(pos, repl.end);
			if (removed.indexOf('\n') >= 0)
				throw new Error("Replacement >>>" + repl.str + "<<< would squash newline of >>>" + removed + "<<<");
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

function splitArrow(node) {
	var arrow = node.expression;
	var params = [];
	var validTuple = true;
	if (arrow.type == COMMA) {
		var len = arrow.children.length;
		for (var i = 0; i < len - 1; i++) {
			var ident = arrow.children[i];
			if (!ident || ident.type != IDENTIFIER) {
				valid = false;
				break;
			}
			params.push(ident.value);
		}
		arrow = arrow.children[len - 1];
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
		throw new Bug('Unexpected call format', rhs);
	return {rhs: rhs, argList: argList, params: params};
}

function filterUnderscores(input) {
	var params = input.slice();
	while (params.length && params[params.length-1] == '_')
		params.pop();
	var count = 0;
	params.forEach(function (p) {
		if (p == '_')
			count++;
	});
	if (count > 1)
		for (var i = 0, n = 1; i < params.length; i++)
			if (params[i] == '_')
				params[i] = '_' + (n++);
	return params;
}

// User error
function Nope(message, node, end) {
	Error.call(this, message);
	Error.captureStackTrace(this, this.constructor);
	this.message = message;
	this.node = (node instanceof Number) ? {start: node, end: end} : node;
}
util.inherits(Nope, Error);

// Internal error
function Bug(message, node, end) {
	Error.call(this, message);
	Error.captureStackTrace(this, this.constructor);
	this.message = message;
	this.node = (node instanceof Number) ? {start: node, end: end} : node;
}
util.inherits(Bug, Error);

/* MAIN */

function rewrite(src, filename, outputFilename) {
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
		if (!(e instanceof Nope) && !(e instanceof Bug))
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
exports.rewrite = rewrite;

function commandName() {
	var script = require('path').basename(process.argv[1]);
	return script.match(/\.js$/) ? script.slice(0, -3) : script;
}

function usage() {
	try {
		var usage = fs.readFileSync(require('path').join(__dirname, 'usage.txt'), 'UTF-8');
		console.error(usage.replace(/nestless/g, commandName()));
	}
	catch (e) {
		console.error(commandName() + ": Couldn't find usage information. Sorry.\n Consult usage.txt in the source repo.");
	}
	finally {
		process.exit(-1);
	}
}

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
			else if (['-g', '--debug'].indexOf(arg) >= 0)
				OPTS.debug = true;
			else if (['-h', '--help'].indexOf(arg) >= 0)
				usage();
			else if (['-o', '--outfile'].indexOf(arg) >= 0) {
				if (outputFilename)
					throw new Error("Multiple output filenames specified.");
				outputFilename = args.shift();
				if (!outputFilename)
					throw new Error("Output filename required.");
			}
			else if (['-v', '--verbose'].indexOf(arg) >= 0)
				OPTS.verbose = true;
			else
				throw new Error("Invalid argument: " + arg);
		}
		if (targets.length > 1 && outputFilename)
			throw new Error("Can't specify an output filename with multiple inputs.");
	}
	catch (e) {
		console.error(commandName() + ': ' + e.message);
		usage();
	}

	if (!OPTS.debug) {
		process.once('uncaughtException', function (err) {
			var bug = !(err instanceof Nope) && !(err instanceof SyntaxError);
			err = err.message || err;
			if (bug)
				console.error(commandName() + ' internal error: ' + err + '\nPass -g to see debug information.');
			else
				console.error(err);
			process.exit(1);
		});
	}

	if (targets.length) {
		targets.forEach(function (filename) {
			var dest = outputFilename;
			if (!dest) {
				var m = filename.match(/^(.*)\.nl$/);
				dest = (m ? m[1] : filename) + '.js';
			}
			var src = fs.readFileSync(filename, 'UTF-8');
			rewrite(src, filename, dest);
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
			rewrite(src, '<stdin>', outputFilename);
		});
	}
}
