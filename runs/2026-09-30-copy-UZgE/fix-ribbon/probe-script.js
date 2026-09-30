var FRAME_ID = "2009:122";
var NODE_IDS = ["2009:134","2009:135"];

var frame = await figma.getNodeByIdAsync(FRAME_ID);
if (!frame || frame.type !== 'FRAME') throw new Error('PCB_PROBE_FRAME');
var fx = frame.absoluteTransform[0][2], fy = frame.absoluteTransform[1][2];
var out = {};
for (var i = 0; i < NODE_IDS.length; i++) {
  var n = await figma.getNodeByIdAsync(NODE_IDS[i]);
  if (!n || n.type !== 'VECTOR') throw new Error('PCB_PROBE_NOT_VECTOR ' + NODE_IDS[i]);
  var t = n.absoluteTransform;
  var pt = function (x, y) { return [t[0][0] * x + t[0][1] * y + t[0][2] - fx, t[1][0] * x + t[1][1] * y + t[1][2] - fy]; };
  var vec = function (v) { return [t[0][0] * v.x + t[0][1] * v.y, t[1][0] * v.x + t[1][1] * v.y]; };
  var net = n.vectorNetwork;
  out[n.id] = {
    vertices: net.vertices.map(function (v) { return pt(v.x, v.y); }),
    segments: net.segments.map(function (s) { return { start: s.start, end: s.end, tangentStart: vec(s.tangentStart), tangentEnd: vec(s.tangentEnd) }; })
  };
}
return { schema: 'pcb.vector-probe.v1', frameId: frame.id, nodes: out };
