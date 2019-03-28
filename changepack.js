/* 
right now, this code *does not* work in node.  for some reason, node handles strings differently and strings can't be packed correctly.

so, to make it work, we need to detect if running in node or a browser
https://stackoverflow.com/questions/34550890/how-to-detect-if-script-is-running-in-browser-or-in-node-js
there are implications to the byte packer code in the way that node handles chars compared to a browser.
for some reason, node handles it differently, so we need to be able to detect and change behavior eventually...

changepack.js does not *yet* work with arrays like:
var a = ["asdf", "fdsa"];

it will, however, work with objects in those arrays:
var a = [	{asdf: 5}, {fdsa: 6} ];


// use in the following manner
var previous = {...}; // the original object
var latest = {...}; // contains any changes from the original object

// intermediary step - returns a json object of changes
var changes = changepack.encode(previous, latest);

// pack into one final buffer
var packedChanges = changepack.packChanges(changes);

// unpack a buffer into intermediary changes
var unpackedChanges = changepack.unpackChanges(packedChanges);

// get back final object with evolutions in place
var evolved = changepack.decode(previous, unpackedChanges);

// evolved should equal the same as latest
*/

var changepack = {};

changepack.types = {
	0: "bool false",               // 0x00
	1: "bool true",                // 0x01
	2: "8 bit int",                // 0x02
	3: "16 bit int",               // 0x03
	4: "32 bit int",               // 0x04
	5: "64 bit int",               // 0x05
	6: "8 bit uint",               // 0x06
	7: "16 bit uint",              // 0x07
	8: "32 bit uint",              // 0x08
	9: "64 bit uint",              // 0x09
	10: "32 bit float",            // 0x0A
	11: "64 bit float",            // 0x0B
	12: "8 bit length string",     // 0x0C
	13: "16 bit length string",    // 0x0D
	14: "32 bit length string",    // 0x0E
	15: "64 bit length string",    // 0x0F
	16: "null",                    // 0x10
	17: "empty array",             // 0x11
	18: "empty object",            // 0x12
	
	240: "remove object",          // 0xF0
	
	255: "NOP",                    // 0xFF
}

/*
takes two javascript objects / arrays and finds the differences in them.

returns a packed array of strings for the representation of those differences
the new object is compared with the old.  only changes in the new object
from the old object will be represented
*/
changepack.encode = function(oldObj, newObj) {
	
	var startTime = new Date().getTime();
	
	// do some sanity checks
	if (typeof oldObj !== "object") {
		console.error("oldObj is not an object or array");
		return "";
	}
	
	if (typeof newObj !== "object") {
		console.error("newObj is not an object or array");
		return "";
	}
	
	// create a list of paths in the old object
	var oldPaths = changepack._paths(oldObj);
	var newPaths = changepack._paths(newObj);
	
	// console.log("oldPaths:");
	// console.log(oldPaths);
	
	// console.log("newPaths:");
	// console.log(newPaths);
	
	// check for added paths and changed values
	var add = [];
	var text = "";
	for (var path in newPaths) {
		
		var change = "";
		var changed = false;
		
		if ( (path in oldPaths) == true) {
			// check to see if value has changed
			if (newPaths[path] != oldPaths[path]) {
				changed = true;
				text = "changing ";
			}
		} else {
			changed = true;
			text = "adding ";
		}
		
		if (changed == true) {
			var actionType = changepack._getActionType(newPaths[path]);
			// console.log(text + path + " = " + actionType + " = 0x" + actionType.toString(16) + " = " + changepack.types[actionType]);
			
			change += String.fromCharCode(actionType);
			change += changepack._packString(path);
			change += changepack._encodeValue(actionType, newPaths[path]);
			
			add.push({change: change, len: change.length, actionType: actionType, actionTypeTitle: changepack.types[actionType]});
		}
	}
	
	
	// check for removed paths
	var remove = [];
	for (var path in oldPaths) {
		var change = "";
		if ( (path in newPaths) == false) {
			// console.log("removing " + path);
			
			change += String.fromCharCode(0xF0);
			change += changepack._packString(path);
			
			remove.push({change: change, len: change.length, actionType: 0xF0, actionTypeTitle: changepack.types[0xF0]});
		}
	}
	
	// console.log("changepack encoding time: " + ( (new Date().getTime() - startTime) ) + " ms" );
	
	return remove.concat(add);
}


// pack all changes into one buffer
changepack.packChanges = function(changes) {
	
	var startTime = new Date().getTime();
	
	// the final length of the packedChanges
	var len = 0;
	
	// add version to beginning of packed string
	var vbuffer = new ArrayBuffer(2);
	var vview = new DataView(vbuffer);
	vview.setUint16(0, 1); // version 1
	var vout = new Uint8Array(vbuffer);
	var packedChanges = String.fromCharCode.apply(null, vout);
	len += 2;
	
	var actionType = 0;
	
	for (var i in changes) {

		if (changes[i].len <= 0xFF) {
			// is 8 bit string?
			actionType = 0x0C;
		} else if (changes[i].len <= 0xFFFF) {
			// is 16 bit string?
			actionType = 0x0D;
		} else if (changes[i].len <= 0xFFFFFFFF) {
			// is 32 bit string?
			actionType = 0x0E;
		}
		
		// one byte for each actionType
		len += 1;
		
		// create right sized buffer
		var buffer = new ArrayBuffer( 1 << (actionType - 0x0C) );
		var view = new DataView(buffer);
		
		// pack the right amount of length bytes
		if (actionType == 0x0C) {
			view.setUint8(0, changes[i].len);
			len += 1;
		} else if (actionType == 0x0D) {
			view.setUint16(0, changes[i].len);
			len += 2;
		} else if (actionType == 0x0E) {
			view.setUint32(0, changes[i].len);
			len += 4;
		}
		
		// the size of the actual change
		len += changes[i].len;
		
		// create a packable view of the buffer
		var out = new Uint8Array(buffer);
		
		// pack the change into a string
		packedChanges += 
		String.fromCharCode(actionType) + // the actionType
		String.fromCharCode.apply(null, out) + // the change length
		changes[i].change; // the actual change
	}
	
	// console.log("changepack packChanges time: " + ( (new Date().getTime() - startTime) ) + " ms" );
	
	return {packedChanges: packedChanges, len: len};
}


// take a buffer change pack from packChanges and decodes it into individual change packs
changepack.unpackChanges = function(packedChanges) {
	
	var startTime = new Date().getTime();
	
	var changes = [];
	
	var curPos = 0;
	var buffer = new ArrayBuffer(8);
	var copy = new Uint8Array(buffer);
	
	// get version
	for (var t = 0; t < 2; t++) {
		copy[t] = packedChanges.charCodeAt(t);
	}
	var view = new DataView(buffer);
	var version = view.getUint16(0);
	
	// console.log("changepack version");
	// console.log(version);
	
	if (version == 1) {
		while (curPos < packedChanges.length) {
			
			// decode action
			var actionType = packedChanges.charCodeAt(curPos);
			curPos += 1;
			
			var change = "";
			var len = 0;
			
			// decode change
			if (actionType >= 0x0C && actionType <= 0x0F) {
				bufLen = 1 << (actionType - 0x0C);
				for (var t = 0; t < bufLen; t++) {
					copy[t] = packedChanges.charCodeAt(curPos + t);
				}
				
				switch (actionType) {
					case 0x0C: // 8 bit string
						len = view.getUint8(0);
						break;
					case 0x0D: // 16 bit string
						len = view.getUint16(0);
						break;
					case 0x0E: // 32 bit string
						len = view.getUint32(0);
						break;
				}
				curPos += bufLen;
				
				change = packedChanges.slice(curPos, curPos + len);
				curPos += len;
				
				changes.push({change: change, len: len});
			}
		}
	}
	
	// console.log("changepack unpackChanges time: " + ( (new Date().getTime() - startTime) ) + " ms" );
	
	return changes;
}



// takes a change set and applies it to an existing object / array
// returns an object representing the changes made to oldObj
changepack.decode = function(oldObj, changes) {
	
	var startTime = new Date().getTime();
	
	var buffer = new ArrayBuffer(8);
	var copy = new Uint8Array(buffer);
	
	for (var i in changes) {
		
		var curPos = 0;
		// console.log("changes: ", changes[i]);
		
		// decode action
		var actionType = changes[i].change.charCodeAt(curPos);
		// console.log("actionType: 0x" + actionType.toString(16));
		curPos += 1;
		
		// decode path
		var pathLen = changes[i].change.charCodeAt(curPos);
		curPos += 1;
		
		var path = changes[i].change.slice(curPos, curPos + pathLen);
		curPos += pathLen;
		// console.log("pathLen: " + pathLen + " - path: '" + path + "'");
		
		// console.log("curPos: " + curPos);
		
		// decode value, if necessary
		var value;
		
		switch (actionType) {
			case 0x00:
				value = false;
				break;
			case 0x01:
				value = true;
				break;
			case 0x10:
				value = null;
				break;
			case 0x11:
				value = [];
				break;
			case 0x12:
				value = {};
				break;
			case 0xFF:
				// nop
		}
		
		
		if (actionType >= 0x02 && actionType <= 0x0F) {
			
			var bufLen = 0;
			if (actionType >= 0x02 && actionType <= 0x05) {
				bufLen = 1 << (actionType - 0x02);
			} else if (actionType >= 0x06 && actionType <= 0x09) {
				bufLen = 1 << (actionType - 0x06);
			} else if (actionType == 0x0A || actionType == 0x0B) {
				bufLen = 4 << (actionType - 0x0A);
			} else if (actionType >= 0x0C && actionType <= 0x0F) {
				bufLen = 1 << (actionType - 0x0C);
			}
			
			// console.log("bufLen");
			// console.log(bufLen);
			
			for (var t = 0; t < bufLen; t++) {
				copy[t] = changes[i].change.charCodeAt(curPos + t);
			}
			
			// console.log("copy");
			// console.log(copy);
			
			var view = new DataView(buffer);
			
			switch (actionType) {
				case 0x02: // int8
					value = view.getInt8(0);
					break;id.length
				case 0x03: // int16
					value = view.getInt16(0);
					break;
				case 0x04: // int32
					value = view.getInt32(0);
					break;
				case 0x05: // int64
					// value = view.getUint64...(0);
					break;
				case 0x0C: // 8 bit string
				case 0x06: // uint8
					value = view.getUint8(0);
					break;
				case 0x0D: // 16 bit string
				case 0x07: // uint16
					value = view.getUint16(0);
					break;
				case 0x0E: // 32 bit string
				case 0x08: // uint32
					value = view.getUint32(0);
					break;
				case 0x0F: // 64 string
				case 0x09: // uint64
					// value = view.getUint64...(0);
					break;
				case 0x0A: // float32
					value = view.getFloat32(0);
					break;id.length
				case 0x0B: // float64
					value = view.getFloat64(0);
			}
			
			if (actionType >= 0x0C && actionType <= 0x0F) {
				var len = value;
				curPos += bufLen; // 1 << (actionType - 0x0C); - bufLen contains the same thing
				value = changes[i].change.slice(curPos, curPos + len);
			}
		}
		
		
		// replay changes on oldObj
		if (actionType == 0xF0) {
			// console.log("removing: "+path);
			// do field removals
			oldObj = changepack._decodePathAndRemove(oldObj, path);
		} else {
			// do field additions and changes
			oldObj = changepack._decodePathAndAssign(oldObj, path, value);
		}
		
	}
	
	// console.log("changepack encoding time: " + ( (new Date().getTime() - startTime) ) + " ms" );
	
	return oldObj;
}


// do a quick check to see if anything has changed
// useful to find out if something has changed, without going through the encoding process
changepack.quickCheck = function(oldObj, newObj) {
	
	var startTime = new Date().getTime();
	
	// create a list of paths in the old object
	oldPaths = changepack._paths(oldObj);
	newPaths = changepack._paths(newObj);
	
	// console.log("oldPaths:");
	// console.log(oldPaths);
	// 
	// console.log("newPaths:");
	// console.log(newPaths);
	
	// check for any additions or changes
	for (var path in newPaths) {
		// console.log("path: " + path + "=" + newPaths[path]);
		if ( (path in oldPaths) == true) {
			// check to see if value has changed
			if (newPaths[path] != oldPaths[path]) {
				// console.log("changepack encoding time: " + ( (new Date().getTime() - startTime) ) + " ms" );
				return true;
			}
		} else {
			// console.log("changepack encoding time: " + ( (new Date().getTime() - startTime) ) + " ms" );
			return true;
		}
	}
	
	// check for any deletions
	for (var path in oldPaths) {
		if ( (path in newPaths) == false) {
			// console.log("changepack encoding time: " + ( (new Date().getTime() - startTime) ) + " ms" );
			return true;
		}
	}
	
	// console.log("changepack encoding time: " + ( (new Date().getTime() - startTime) ) + " ms" );
	return false;
}


// private methods


// decode the chain of a flat path and remove that key
changepack._decodePathAndRemove = function(obj, path) {
	var tpath = path.split(".");
	// console.log("tpath: " + tpath);
	
	// sanity
	if (tpath.length == 0) return obj;
	
	// define references to top level object
	var object = obj;
	var cur = obj;
	var lastCur = cur;
	for (var t = 0; t < tpath.length-1; t++) {
		if ( (tpath[t] in cur) == true) {
			// go to next key
			lastCur = cur;
			cur = cur[ tpath[t] ];
		}
	}
	
	// delete the key
	if (cur != undefined) {
		delete cur[ tpath[ tpath.length-1 ] ];
		
		// check for empty object and go up one level and delete the higher up as well
		if (Object.keys( cur ).length === 0) {
			if ( (lastCur instanceof Array) == true ) {
				lastCur.splice(tpath[ tpath.length-2 ], 1);
			}
		}
		
		// if array element, shift the element off the stack
		// if (cur[ tpath[ tpath.length-1 ] ] instanceof Array) {
		// 	console.log("Array");
		// } else {
		// }
	}
	
	return object;
}

// decode the chain of a flat path and assign the value to that path
changepack._decodePathAndAssign = function(obj, path, value) {

	// sanity
	if (obj == undefined) throw "object is not defined";
	
	var tpath = path.split(".");
	// console.log("tpath: " + tpath);
	
	// sanity
	if (tpath.length == 0) return obj;
	
	// if the top level is an array, make the object an array
	// otherwise, leave it alone
	// if something already exists, leave it alone
	obj = isNaN(tpath[0]) == false ? (obj instanceof Array) == false ? [] : obj : obj;
	
	// object to build upon
	var cur = obj;
	// reference to top level
	var object = obj;
	
	// do we need to create the key and write the value?
	for (var t = 0; t < tpath.length; t++) {
		
		// does the key exist?
		if ( (tpath[t] in cur) == false) {
			
			// check if cur[t+1] is an object or an array, otherwise write the value
			if ( t+1 < tpath.length && isNaN(tpath[t+1]) == false) {
				// looks like an array
				cur[ tpath[t] ] = [];
			} else if (t+1 < tpath.length && isNaN(tpath[t+1]) == true) {
				// looks like an object
				cur[ tpath[t] ] = {};
			} else {
				// write value into cur
				cur[ tpath[t] ] = value;
			}
			
		} else if ( (tpath[t] in cur) == true && t+1 == tpath.length ) {
			// if we get here, the path already exists and we just need to write the value
			cur[ tpath[t] ] = value;
		}

		// go to next path member
		cur = cur[ tpath[t] ];
		
	}
	
	
	// the key already exists, so 
	// if (created == false) {
	// 	for (var t = 0; t < tpath.length-1; t++) {
	// 		if ( (tpath[t] in cur) == true) {
	// 			// go to next key
	// 			lastCur = cur;
	// 			cur = cur[ tpath[t] ];
	// 		}
	// 	}
	// 
	// 	// delete the key
	// 	if (cur != undefined) {
	// 	}
	// }
	// cur = value;
	
	return object;
}


// packs the value into a string
changepack._encodeValue = function(actionType, value) {
	if (actionType == 0x00) {
		
		// is bool false?
		// don't encode anything.  it's in the actionType
		
	} else if (actionType == 0x01) {
		
		// is bool true?
		// don't encode anything.  it's in the actionType
		
	} else if (actionType == 0x02) {
		
		// is 8 bit int?
		var buffer = new ArrayBuffer(1);
		var view = new DataView(buffer);
		view.setInt8(0, value);
		var out = new Uint8Array(buffer);
		// console.log("int8: ", out);
		return String.fromCharCode.apply(null, out);
		
	} else if (actionType == 0x03) {
		
		// is 16 bit int?
		var buffer = new ArrayBuffer(2);
		var view = new DataView(buffer);
		view.setInt16(0, value);
		var out = new Uint8Array(buffer);
		// console.log("int16: ", out);
		return String.fromCharCode.apply(null, out);
		
	} else if (actionType == 0x04) {
		
		// is 32 bit int?
		// console.log("value:", value);
		var buffer = new ArrayBuffer(4);
		var view = new DataView(buffer);
		view.setInt32(0, value);
		var out = new Uint8Array(buffer);
		// console.log("int32: ", out);
		return String.fromCharCode.apply(null, out);
		
	} else if (actionType == 0x05) {
		// is 64 bit int?
		
	} else if (actionType == 0x06) {
		
		// is 8 bit uint?
		var buffer = new ArrayBuffer(1);
		var view = new DataView(buffer);
		view.setUint8(0, value);
		var out = new Uint8Array(buffer);
		// console.log("uint8: ", out);
		return String.fromCharCode.apply(null, out);
		
	} else if (actionType == 0x07) {
		
		// is 16 bit uint?
		var buffer = new ArrayBuffer(2);
		var view = new DataView(buffer);
		view.setUint16(0, value);
		var out = new Uint8Array(buffer);
		// console.log("uint16: ", out);
		return String.fromCharCode.apply(null, out);
		
	} else if (actionType == 0x08) {
		
		// is 32 bit uint?
		var buffer = new ArrayBuffer(4);
		var view = new DataView(buffer);
		view.setUint32(0, value);
		var out = new Uint8Array(buffer);
		// console.log("uint32: ", out);
		return String.fromCharCode.apply(null, out);
		
	} else if (actionType == 0x09) {
		// is 64 bit uint?
		
	} else if (actionType == 0x0A) {
		// is 32 bit float?
		
	} else if (actionType == 0x0B) {
		
		// is 64 bit float?
		var buffer = new ArrayBuffer(8);
		var view = new DataView(buffer);
		view.setFloat64(0, value);
		var out = new Uint8Array(buffer);
		// console.log("float64: ", out);
		return String.fromCharCode.apply(null, out);
		
	} else if (actionType == 0x0C) {

		// is 8 bit length string?
		var buffer = new ArrayBuffer(1);
		var view = new DataView(buffer);
		view.setUint8(0, value.length);
		var out = new Uint8Array(buffer);
		return String.fromCharCode.apply(null, out) + value;
		
	} else if (actionType == 0x0D) {

		// is 16 bit length string?
		var buffer = new ArrayBuffer(2);
		var view = new DataView(buffer);
		view.setUint16(0, value.length);
		var out = new Uint8Array(buffer);
		return String.fromCharCode.apply(null, out) + value;
		
	} else if (actionType == 0x0E) {

		// is 32 bit length string?
		var buffer = new ArrayBuffer(4);
		var view = new DataView(buffer);
		view.setUint32(0, value.length);
		var out = new Uint8Array(buffer);
		return String.fromCharCode.apply(null, out) + value;

	} else if (actionType == 0x0F) {
		// is 64 bit length string?
	} else if (actionType == 0x10) {
		// is null?
		// don't encode anything.  it's in the actionType
	} else if (actionType == 0x11) {
		// is empty array?
		// don't encode anything.  it's in the actionType
	} else if (actionType == 0x12) {
		// is empty object?
		// don't encode anything.  it's in the actionType
	}
	
	return "";
}


// packs a string into binary format
changepack._packString = function(value) {
	
	if (value.length <= 0xFF) {
		// is 8 bit string?
		var buffer = new ArrayBuffer(value.length + 1);
		var view = new Uint8Array(buffer);
		view[0] = value.length;
		for (var t = 0; t < value.length; t++) {
			view[t+1] = value.charCodeAt(t);
		}
		
		// view.set(value, 1);
		// console.log("view");
		// console.log(view);
		return String.fromCharCode.apply(null, view);
	} else {
		console.error("string to pack was too long.  must be less than 256 chars");
	}
	return "";
}


// checks the type and creates the actionType byte
changepack._getActionType = function(value) {
	
	// is number?
	if (typeof value == "number") {
		// what kind of number?  float or int
		if ( (value | 0) == value) {
			
			// int
			
			// what type of minor int is it?
			if (value >= 0x00 && value <= 0xFF) {
				// is 8 bit uint?
				return 0x06;
			} else if (value >= 0x00 && value <= 0xFFFF) {
				// is 16 bit uint?
				return 0x07;
			} else if (value >= 0x00 && value <= 0xFFFFFFFF) {
				// is 32 bit uint?
				return 0x08;
				
			} else if (value >= -128 && value < 0) {
				// is 8 bit int?
				return 0x02;
			} else if (value >= -32768 && value < 0) {
				// is 16 bit int?
				return 0x03;
			} else if (value >= -2147483648 && value < 0) {
				// is 32 bit int?
				return 0x04;
			}
			
		} else {
			
			// is a float?  return a 64 bit float for now
			return 0x0B;
		}
	}
	
	// is value a string?
	if (typeof value == "string") {
		if (value.length <= 0xFF) {
			// is 8 bit string?
			return 0x0C;
		} else if (value.length <= 0xFFFF) {
			// is 16 bit string?
			return 0x0D;
		} else if (value.length <= 0xFFFFFFFF) {
			// is 32 bit string?
			return 0x0E;
		}
	}
	
	// is value a bool?
	if (typeof value == "boolean") {
		return (value ? true : false);
	}
	
	// is value a null?
	if (value == null) {
		return 0x10;
	}

	// is value an empty object?
	if ( (value instanceof Array) == true) {
		return 0x11;
	}
	
	// is value an empty array?
	if ( (value instanceof Object) == true) {
		return 0x12;
	}
	
	// won't match anything and is reserved
	return 0xFF;
}

// this outputs an array of {path: "", value: ""} objects
// with inspiration from: https://stackoverflow.com/a/40053014
changepack._paths = function(obj) {
	
	var paths = {};
	var objects = [ {path: "", obj: obj} ];
	
	while (objects.length > 0) {
		
		var obj = objects.shift();
		
		var keys = Object.keys( obj.obj );
		
		// if we have an empty something, write it anyways, but not if it's
		// objects[0] aka the first objects item with a blank path
		if (keys.length == 0 && obj.path != "") {
			paths[ obj.path ] = obj.obj;
		}
		
		for (var key in keys) {
			if ( obj.obj[ keys[key] ] instanceof Object || obj.obj[ keys[key] ] instanceof Array ) {
				objects.push({
					path: obj.path == "" ? keys[key] : obj.path + "." + keys[key], 
					obj: obj.obj[ keys[key] ],
				});
			} else {
				if ( Object.prototype.toString.call( obj.obj[ keys[key] ] ) != "[object Array]" ) {
					paths[ obj.path == "" ? keys[key] : obj.path + "." + keys[key] ] = obj.obj[ keys[key] ];
				}
			}
		}
	}
	
	return paths;
}

// var obj1 = {};
// var obj2 = {
// 	name: "",
// 	address: "",
// 	timeWorked: [],
// }
// var a = {
// 	foo: "bar", 
// 	asdf: [
// 		"asdf", 
// 	],
// 	sdfgh: "rth"
// };
// var b = {
// 	foo: "bar", 
// 	asdf: [
// 		"asdff", 
// 		{fdsa: 0.5}
// 	],
// 	// string1: "".padStart(139, "0"),
// };


// var a = {};
// var b = {
// 	// foo1: "".padStart(100000, "0"),
// 	// foo2: 100000000000.1111,
// 	foo3: true,
// 	foo4: {
// 		foo5: {
// 			foo6: {
// 				foo7: true
// 			}
// 		}
// 	},
// 	foo9: null,
// 	foo10: [
// 		"asdf1", 
// 		"asdf2", 
// 		"asdf3", 
// 		{foo20: false}
// 	],
// };
// 
// // test types
// var b = {
// 	// ints
// 	int1: 0,
// 	int2: 1,
// 	int3: 0xFF,
// 	int4: 0xFF1,
// 	int5: 0xFFFF,
// 	int6: 0xFFFF1,
// 	int7: 0xFFFFFFFF, // for some reason triggers a float64
// 	int8: 0xEFFFFFFF, // for some reason triggers a float64
// 	int9: 0xFFFFFFFE, // for some reason triggers a float64
// 	int10: 4294967295, // for some reason triggers a float64
// 	int11: 4294967296, // for some reason triggers a float64
// 
// 	int12: -1,
// 	int13: -128,
// 	int14: -256,
// 	int15: -32768,
// 	int16: -65535,
// 	int17: -2147483647,
// 
// 	float1: 0.0,
// 	float2: 0.1,
// 	float3: 255.5,
// 	float4: 345654020.12,
// 	float5: -345654020.12,
// 	float6: -255.5,
// 	float7: -0.1,
// 
// 	string1: "".padStart(55, "0"),
// 	// string2: "".padStart(500, "0"),
// 	// string4: "".padStart(65535, "0"),
// 	// string4: "".padStart(65536, "0"),
// 	// string5: "".padStart(100000, "0"),
// 
// 	bool1: false,
// 	bool2: true,
// 
// 	null1: null,
// }

// var changes = changepack.encode(a,b, "jerkrichardsasdf");
// 
// console.log(changes);
// 
// var decoded = changepack.decode(a, changes);
// 
// console.log("decoded");
// console.log(decoded);


// var obj1 = {};
// console.log('changepack._decodePathAndAssign(obj1, "foo1.foo2", 1)');
// console.log(changepack._decodePathAndAssign(obj1, "foo1.foo2", 1));
// 
// var obj2 = {};
// console.log('changepack._decodePathAndAssign(obj2, "foo1.foo2.0", 1)');
// obj2 = changepack._decodePathAndAssign(obj2, "foo1.foo2.0", 10);
// obj2 = changepack._decodePathAndAssign(obj2, "foo1.foo2.1", 20);
// console.log(obj2);
// 
// var obj3 = {};
// console.log('changepack._decodePathAndAssign(obj3, "0", 1)');
// obj3 = changepack._decodePathAndAssign(obj3, "0", 1);
// obj3 = changepack._decodePathAndAssign(obj3, "1", 2);
// console.log(obj3);

/*
var obj={
	foo1: {
		foo2: [
			{foo4: 10},
			{foo5: 20},
		]
	}
}
var changes = changepack.encode(a, obj, "29d98a587bee020", "jerkrichardsasdf");

console.log(changes);

*/

// var obj4 = {};
// console.log('changepack._decodePathAndAssign(obj4, "foo1.foo2.0", 1)');
// obj4 = changepack._decodePathAndAssign(obj4, "foo1.foo2.0.foo4.0", 10);
// obj4 = changepack._decodePathAndAssign(obj4, "foo1.foo2.0.foo4.1", 15);
// obj4 = changepack._decodePathAndAssign(obj4, "foo1.foo2.1.foo5", 20);
// console.log(obj4);
// 
// obj4 = changepack._decodePathAndRemove(obj4, "foo1.foo2.1");
// console.log(obj4);


/*
var obj = {
	foo1: [
		{foo2: false}
	]
}

next = obj;
console.log("next");
console.log(next);

next = next["foo1"];
console.log("next");
console.log(next);

next = next[0];
console.log("next");
console.log(next);

next["foo2"] = true
console.log("next");
console.log(next);
*/

// obj.foo1.foo2.push("asdf");


/*
// we don't want to overwrite anything, so we have this check here
// (tpath[t] in next) == false && 
// if ( (next instanceof Array) == false) {
if ( (tpath[t] in next) == false && isNaN(tpath[t]) == true ) {
	// var endPoint = t < tpath.length-1 ? isNaN(tpath[t+1]) == false ? [] : {} : value;
	
	// can we add something
	if (t < tpath.length-1) {
		if ( (tpath[t] in next) == false ) {
			if (isNaN(tpath[t+1]) == false) {
				endPoint = [];
			} else {
				endPoint = {};
			}
		} else {
			// key already exists, nothing to write here, just continue
			next = next[ tpath[t] ];
			continue;
		}
	} else {
		endPoint = value;
	}
	
	next[ tpath[t] ] = endPoint;
	
} else if (isNaN(tpath[t]) == false) {
	// is this an array entry?
	// if so, add the array element with an empty object, array, or a value
	
} else {
	// the key already exists, so check if it's an array and add the key/value.  otherwise, just leave it alone
	// if () {
	// 
	// }
	next[ tpath[t] ] = value;
}

next = next[ tpath[t] ];
*/


// var a = {a:"", b:"1", c:["asdf"]};
// var b = {a:"1", b:"1", c:["asdf"]};
// 
// console.log(changepack.quickCheck(a,b));
