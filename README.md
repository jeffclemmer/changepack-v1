Quick Warning
-------------

This software is **BETA** software.  It still needs more tests written, performance tuning, and some security testing.

What Does ChangePack Do?
-------------------------

In a nutshell, it basically gives you a diff of two JSON objects and then packs that diff into a packed binary format. It allows you to track changes over time to an object or calculate differences between two objects.

Another way you can look at this is to think of it tracking the evolution of an object. Each evolutionary stage will be packed into a simple format and those changes can be applied to another copy of the original object to bring it to it's most recent state.

Let me introduce some concepts behind this library. In my use case, I use it to track each change a user or users make to an object. For example, in one of my use cases, multiple users can update a work order by updating the hours they worked, within a larger work order object.

Instead of saving the entire work order object to the database each time to track each change, I just want to track the small changes that were made. Here's the initial work order:

    var workorder = {
    	company: "Terwil Corp.",
    	address: "1234 Main St",
    	workNeeded: "Install pipes",
    	timeWorked: [],
    }

After the technicians have installed the pipes, only Jim fills out the work order to include his one hour for the work he did:

    var workorder = {
    	company: "Terwil Corp.",
    	address: "1234 Main St",
    	workNeeded: "Install pipes",
    	timeWorked: [
    		{tech: "Jim", started: 1552868624, ended: 1552872224}
    	],
    }

Later on, Bob fills out his hours:

    var workorder = {
    	company: "Terwil Corp.",
    	address: "1234 Main St",
    	workNeeded: "Install pipes",
    	timeWorked: [
    		{tech: "Jim", started: 1552868624, ended: 1552872224},
    		{tech: "Bob", started: 1552868624, ended: 1552872224},
    	],
    }

What will changepack.js do with these three objects?

For the **first** change, it will pack the entire object into a packed binary object.

For the **second** change, it will only pack the first "timeWorked" array entry (Jim) into a binary object.

For the **third** change, it will only pack the second "timeWorked" array entry (Bob) into a binary object.

* * *

The API
-------

Before we go into any more detail, let's take a look at the API.

The API includes the following methods:

    encode(previous, latest)
    packChanges(changes)
    unpackChanges(packedChanges)
    decode(previous, unpackedChanges)
    quickCheck(previous, latest)

There are also a few "private" methods which support the public method API and are prefixed with underscores. These methods should not be used directly. These private methods are:

    _decodePathAndRemove(object, path)
    _decodePathAndAssign(obj, path, value)
    _encodeValue(actionType, value)
    _packString(value)
    _getActionType(value)
    _paths(obj)

* * *

Using the API - Encoding and Packing
------------------------------------

The library is pretty easy to use. We'll set this up with the first work order change and the second change. We'll then calculate the difference between the first and second change. We'll pretend that we've already saved the first change and we now need the second change.

    // initial work order
    var firstChange = {
    	company: "Terwil Corp.",
    	address: "1234 Main St",
    	workNeeded: "Install pipes",
    	timeWorked: [],
    }
    
    // Jim fills out his hours
    var secondChange = {
    	company: "Terwil Corp.",
    	address: "1234 Main St",
    	workNeeded: "Install pipes",
    	timeWorked: [
    		{tech: "Jim", started: 1552868624, ended: 1552872224}
    	],
    }
    
    // returns a json object of changes
    var changes = changepack.encode(firstChange, secondChange);
    
    // pack into one final contiguous buffer
    var packedChanges = changepack.packChanges(changes);
    
    // let's see what packedChanges looks like
    console.log(packedChanges);

Console.log output:

    {packedChanges: "ð↵timeWorkedtimeWorked.0.techJimtimeWorked.0.started\åtimeWorked.0.ended\ó ", len: 95}

Looks like binary blob madness! That's exactly what we're looking for.

At this point, we would send packedChanges to the server and save it to a changes table in a time series style format.

* * *

Using the API - Unpacking and Decoding
--------------------------------------

When a user requests the changes from the server, it comes back similarly to the above console.log output. How do we decode it back to a JSON object?

We assume that we only have the first change on this client and need to evolve the object into it's latest incarnation. We'll do that with the following code:

    // initial work order
    var firstChange = {
    	company: "Terwil Corp.",
    	address: "1234 Main St",
    	workNeeded: "Install pipes",
    	timeWorked: [],
    }
    
    // not sure if copying and pasting this would be good.
    // this should really be coming from the encoding stage above.
    var packedChanges = "ð↵timeWorkedtimeWorked.0.techJimtimeWorked.0.started\åtimeWorked.0.ended\ó ";
    
    // unpack a contiguous buffer into intermediary changes
    var unpackedChanges = changepack.unpackChanges(packedChanges);
    
    // get back final object with evolutions in place
    var evolved = changepack.decode(firstChange, unpackedChanges);
    
    // let's see what evolved looks like
    console.log(evolved);
    

And the output from console.log() in dev tools:

    address: "1234 Main St"
    company: "Terwil Corp."
    workNeeded: "Install pipes"
    timeWorked: Array(1)
    	0:
    		ended: 1552872224
    		started: 1552868624
    		tech: "Jim"
    		length: 1

This code will essentially add the array entry to timeWorked.

* * *

Using the API - Checking For Any Differences
--------------------------------------------

So, we've got a large object that may or may not have changed. How do we quickly check if an object has changed?

    // returns true or false
    if (changepack.quickCheck(firstChange, secondChange) == true) {
    	// things have changed, let's do something
    }

quickCheck is great when you just need to see if something has changed.

* * *

Some Limitations and Needed Optimizations
-----------------------------------------

As of the writing of this blog post, there are some limitations and some needed optimizations that need to be done on this library.

* * *

**\* Optimization**: Packed objects could be shrunk a little more:

Please note that the size of the packed string may or may not be smaller than using pure stringified JSON. I've seen it equal out to about the same in my limited testing. Some things are smaller, some are bigger. I'm not trying to replace stringified JSON. However, If I tried to pack these changes into stringified JSON, it would be even bigger than regular stringified JSON, so there's that.

* * *

**\* Limitation**: changepack.js needs a lot more testing. I also need to do some performance benchmarking as well.

I've only tested it with small JSON objects. I need to do some testing with medium and large sized objects. I have no idea how it will perform with large objects and changes.

* * *

**\* Limitation**: changepack.js doesn't have an implementation for 64 bit ints, unsigned ints, or strings. However, the binary format has been defined for these. 64 bit floats have been implemented and 32 bit floats have not.

* * *

**\* Unknown**: changepack.js hasn't been tested for object tree depth. However, changepack.js can only encode an object path into max 256 characters. This may change in the future.

* * *

**\* Optimization**: Code can always run faster and use less memory. I'm especially targetting optimizations in \_encodeValue() for the near future.

* * *

Changepack Binary Layout
------------------------

This section describes the layout of the output of changepack.js.

Everything in changepack.js is defined as an actionType. An actionType is composed of a single encoded byte. It defines either an action or a type. For example, a type would be an 8 bit unsigned int. An action would be "remove object from tree".

When encoding, the objects passed are "flattened" into a new Javascript object. For example:

    var obj = {
    	foo1: [
    		{foo2: false}
    	]
    }

comes out to be:

    {foo1.0.foo2: false}

Another example:

    var a = {
    	asdf: [
    		"asdf", 
    		"fdsa", 
    	],
    	foo: "bar", 
    	sdfgh: "rth"
    };
    

comes out to be:

    {
    	asdf.0: "asdf",
    	asdf.1: "fdsa",
    	foo: "bar",
    	sdfgh: "rth",
    }

Arrays are defined with a number. For example, "asdf.0" represents array element position 0 in the "asdf" array.

Object sub properties are delineated using a dot ("."). For example, if you have the following object,

    {foo1.foo2.foo3: "hello world"}

changepack.js will expand it back to:

    {
    	foo1: {
    		foo2: {
    			foo3: "hello world"
    		}
    	}
    }

changepack.js will detect additions, changes, and deletions from an object or array aka the actionType. It encodes these detections into a binary byte format into a string.

Use the following as a guide to each actionType:

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

changepack.js use a byte encoding scheme that packs the actionType, the object tree path, and the object tree value into a string. The following describes the format for this encoding scheme:

    // Initial encoding
    +----------------+------------------+
    |    byte pos    | what's encoded   |
    +----------------+------------------+
    |              0 | actionType       |
    |              1 | path string len  |
    |          2-257 | path string      |
    +----------------+------------------+
    
    // encode numbers
    if (typeof value == "number")
    +----------+----------+-------------------+
    |   type   | byte pos | what's encoded    |
    +----------+----------+-------------------+
    |     int8 |       +1 | the actual number |
    |    int16 |       +2 | the actual number |
    |    int32 |       +4 | the actual number |
    |    int64 |       +8 | the actual number |
    |    uint8 |       +1 | the actual number |
    |   uint16 |       +2 | the actual number |
    |   uint32 |       +4 | the actual number |
    |   uint64 |       +8 | the actual number |
    |  float32 |       +4 | the actual number |
    |  float64 |       +8 | the actual number |
    +----------+----------+-------------------+
    
    // encode strings
    if (typeof value == "string")
    +--------------------------------------+----------+----------------+
    | type                                 | byte pos | what's encoded |
    +--------------------------------------+----------+----------------+
    | str len < 256                        |       +1 | value len      |
    |                                      |     then | value          |
    | str len < 65,536                     |       +2 | value len      |
    |                                      |     then | value          |
    | str len < 4,294,967,296              |       +4 | value len      |
    |                                      |     then | value          |
    | str len < 18,446,744,073,709,551,616 |       +8 | value len      |
    |                                      |     then | value          |
    +--------------------------------------+----------+----------------+

To give an example of how to encode a string, let's pretend we have an object with a string that is 1,000 chars long.

    var obj = {
    	// 1000 chars long...
    	foo: "..."
    }

The encoding would look like:

    +----------+--------------------------+
    | byte pos | what's encoded           |
    +----------+--------------------------+
    |        0 | 0x0D (actionType uint16) |
    |        1 | 0x03 (path string len)   |
    |        2 | "f" (first path char)    |
    |        3 | "o" (second path char)   |
    |        4 | "o" (third path char)    |
    |        5 | (MSB string length)      |
    |        6 | (LSB string length)      |
    |        7 | "." (first string char)  |
    |        8 | "." (second string char) |
    |        9 | "." (third string char)  |
           ...
    |     1007 | "." (last string char)   |
    +----------+--------------------------+

Let's say you have the following object:

    var obj = {
    	foo: 1000
    }

The encoding would look like:

    +----------+-------------------------------+
    | byte pos | what's encoded                |
    +----------+-------------------------------+
    |        0 | 0x07 (actionType 16 bit uint) |
    |        1 | 0x03 (path string len)        |
    |        2 | "f" (first path char)         |
    |        3 | "o" (second path char)        |
    |        4 | "o" (third path char)         |
    |        5 | (MSB of value)                |
    |        6 | (LSB of value)                |
    +----------+-------------------------------+

Let's say you have the following object:

    var obj = {
    	foo: false
    }

The encoding would look like:

    +----------+------------------------------+
    | byte pos | what's encoded               |
    +----------+------------------------------+
    |        0 | 0x00 (actionType bool false) |
    |        1 | 0x03 (path string len)       |
    |        2 | "f" (first path char)        |
    |        3 | "o" (second path char)       |
    |        4 | "o" (third path char)        |
    +----------+------------------------------+

More Information
----------------

See more here: [jeffclemmer.net blog](https://jeffclemmer.net/blog/changepack-js.html)

**NOTE:** changepack.js correctly handles platform endianess via standard Javascript APIs. The defined endianess is "big-endian" (MSB to LSB).

**WARNING**: This library is not yet compatible with Node. There will be a future update that makes it compatible with server side Node usage using the same API.

**WARNING:** This document describes v1 of the library. A second version will be written in the near future. This second version will not include any backwards compatibility built in. The header of a packed change does carry the version, so you can identify between the two. The second version will remove packChanges() and unpackChanges() from the API and change the way changes are packed.
