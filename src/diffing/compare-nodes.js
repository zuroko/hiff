var _ = require('underscore');
var node = require('../util/cheerio-utils').node;

var canonicalizeText = require('../util/cheerio-utils').canonicalizeText;
var canonicalizeAttribute = require('../util/cheerio-utils').canonicalizeAttribute;
var nodeType = require('../util/cheerio-utils').nodeType;
var changeTypes = require('./change-types');

module.exports = compareNodes;

var DiffLevel = require('./change-types').DiffLevel;

// ========================================================================================

function compareNodes($n1, $n2, options) {

  var key = $n1[0].__uid + ':' + $n2[0].__uid;

  // do we have a memoized result?
  if (options.memo && (options.memo[key] !== undefined)) {
    return options.memo[key];
  }

  // should we ignore the comparison completely?
  if (options.ignore) {
    if (isIgnored($n1) && isIgnored($n2))
      return false;
  }

  // compare and memoize result
  var result = findDifferences($n1, $n2);
  if (options.memo) {
    options.memo[key] = result;
  }

  // return
  return result;

  // ==========================================================================================

  function findDifferences($n1, $n2) {
    // determine node types
    var type1 = nodeType($n1), type2 = nodeType($n2);

    // if the types aren't the same, that means it's completely different
    if (type1 != type2) {
      return {
        level: DiffLevel.NOT_THE_SAME_NODE,
        changes: [changeTypes.changed($n1, $n2)]
      };
    }

    // compare the nodes using logic specific to their type
    switch (type1) {
      case 'text': return compareTextNodes($n1, $n2);
      case 'element': return compareTags($n1, $n2);
      case 'directive':
      case 'comment':
        return compareOuterHTML($n1, $n2);
      default:
        throw new Error("Unrecognized node type: " + type1);
    }
  }

  function compareTags($n1, $n2) {
    var changes = [];
    var foundChanges = 0, possibleChanges = 0;

    // if the tags have different names, they're not very similar
    possibleChanges++;
    if ($n1[0].name != $n2[0].name) {
      changes.push(changeTypes.changed($n1, $n2));
      foundChanges++;
    }

    // they should have the same attributes too
    var attributesOnNode1 = _.keys($n1[0].attribs);
    var attributesOnNode2 = _.keys($n2[0].attribs);
    var attributes = _.uniq(attributesOnNode1.concat(attributesOnNode2));
    possibleChanges += attributes.length;

    _.map(attributes, function (attribute) {
      var value1 = canonicalizeAttribute($n1[0].attribs[attribute]);
      var value2 = canonicalizeAttribute($n2[0].attribs[attribute]);
      if (value1 != value2) {
        foundChanges++;
        if (!changes.length) {
          changes.push(changeTypes.changed($n1, $n2));
        }
      }
    });

    // we compare the children too, and return all the changes aggregated
    possibleChanges += _.max([$n1.contents().length, $n2.contents().length]);
    var childChanges = compareChildren($n1, $n2, options);
    changes = changes.concat(childChanges);

    _.each(childChanges, function(change) {
      if (change.in == $n1 || change.in == $n2) {
        switch(change.type) {
          case 'added':
          case 'removed':
            foundChanges += 0.5;
            break;
          default:
            foundChanges += 1;
        }
      }
    });

    // no changes?
    if (!changes.length)
      return false;

    // determine similarity to find out if this is the same node, or completely different
    var similarity = 1.0 - (foundChanges / possibleChanges);
    var level = (similarity < 0.51) ? DiffLevel.NOT_THE_SAME_NODE : DiffLevel.SAME_BUT_DIFFERENT;
    return {
      level: level,
      changes: changes
    };
  }

  function compareChildren($n1, $n2, options) {
    var list1 = _.map($n1.contents(), function(n) {
      return node($n1.cheerio, n);
    });
    var list2 = _.map($n2.contents(), function(n) {
      return node($n2.cheerio, n);
    });
    return compareNodeLists($n1, list1, list2, options);
  }


  function compareNodeLists($parent, list1, list2, options) {
    var nodeDiff = require('./node-list-diff');
    var parts = nodeDiff.diffLists(list1, list2, options);

    // map the result from the diff module to something matching our needs
    var index1 = 0, index2 = 0, changes = [];
    _.each(parts, function(part) {
      // unchanged parts
      if (!part.added && !part.removed) {
        var nodesToCheck = _.zip(list1.slice(index1, index1 + part.count), list2.slice(index2, index2 + part.count));
        index1 += part.count; index2 += part.count;
        _.each(nodesToCheck, function(pair) {
          var nodeCompare = compareNodes(pair[0], pair[1], options);
          if (nodeCompare) {
            changes = changes.concat(nodeCompare.changes);
          }
        });
      } else if (part.added) {
        var addedNodes = list2.slice(index2, index2 + part.count);
        index2 += part.count;
        changes = changes.concat(addedNodes.map(function(node) {
          return changeTypes.added($parent, node);
        }));
      } else if (part.removed) {
        var removedNodes = list1.slice(index1, index1 + part.count);
        index1 += part.count;
        changes = changes.concat(removedNodes.map(function(node) {
          return changeTypes.removed($parent, node);
        }));
      }
    });

    // end of the list, we're done
    return changes;
  }

  function compareTextNodes($n1, $n2) {
    var t1 = canonicalizeText($n1.text());
    var t2 = canonicalizeText($n2.text());
    if (t1 != t2) {
      return {
        level: DiffLevel.SAME_BUT_DIFFERENT,
        changes: [changeTypes.changedText($n1, $n2)]
      };
    } else {
      return false;
    }
  }

  function compareOuterHTML($n1, $n2) {
    var html1 = $n1.cheerio.html($n1);
    var html2 = $n2.cheerio.html($n2);
    if (html1 != html2) {
      return {
        level: DiffLevel.SAME_BUT_DIFFERENT,
        changes: [changeTypes.changedText($n1, $n2)]
      };
    } else {
      return false;
    }
  }

  function isIgnored($node) {
    if (!$node) return false;
    if (!options.ignore) return false;
    if (nodeType($node) != 'element') return false;

    // a node is ignored if it matches any selector in options.ignore
    return _.any(options.ignore, function(selector) {
      return $node.is(selector);
    });
  }
}


