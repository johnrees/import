const fs = require("fs");
const axios = require("axios");
const { v4 } = require("uuid");

const authority = "osl";

/**
 * Fancy ID generator that creates 20-character string identifiers with the following properties:
 *
 * 1. They're based on timestamp so that they sort *after* any existing ids.
 * 2. They contain 72-bits of random data after the timestamp so that IDs won't collide with other clients' IDs.
 * 3. They sort *lexicographically* (so the timestamp is converted to characters that will sort properly).
 * 4. They're monotonically increasing.  Even if you generate more than one in the same timestamp, the
 *    latter ones will sort after the former ones.  We do this by using the previous random bits
 *    but "incrementing" them by 1 (only in the case of a timestamp collision).
 */
const generatePushID = (function() {
  // Modeled after base64 web-safe chars, but ordered by ASCII.
  var PUSH_CHARS =
    "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";

  // Timestamp of last push, used to prevent local collisions if you push twice in one ms.
  var lastPushTime = 0;

  // We generate 72-bits of randomness which get turned into 12 characters and appended to the
  // timestamp to prevent collisions with other clients.  We store the last characters we
  // generated because in the event of a collision, we'll use those same characters except
  // "incremented" by one.
  var lastRandChars = [];

  return function() {
    var now = new Date().getTime();
    var duplicateTime = now === lastPushTime;
    lastPushTime = now;

    var timeStampChars = new Array(8);
    for (var i = 7; i >= 0; i--) {
      timeStampChars[i] = PUSH_CHARS.charAt(now % 64);
      // NOTE: Can't use << here because javascript will convert to int and lose the upper bits.
      now = Math.floor(now / 64);
    }
    if (now !== 0)
      throw new Error("We should have converted the entire timestamp.");

    var id = timeStampChars.join("");

    if (!duplicateTime) {
      for (i = 0; i < 12; i++) {
        lastRandChars[i] = Math.floor(Math.random() * 64);
      }
    } else {
      // If the timestamp hasn't changed since last push, use the same random number, except incremented by 1.
      for (i = 11; i >= 0 && lastRandChars[i] === 63; i--) {
        lastRandChars[i] = 0;
      }
      lastRandChars[i]++;
    }
    for (i = 0; i < 12; i++) {
      id += PUSH_CHARS.charAt(lastRandChars[i]);
    }
    if (id.length != 20) throw new Error("Length should be 20.");

    return id;
  };
})();

const allIds = {};

const getType = type => {
  switch (type) {
    case "Flow":
      return 0;
    case "Statement":
      return 100;
    case "Response":
      return 200;
    case "Portal":
      return 300;
    default:
      throw "not found";
  }
};

const parseToImport = (data, ob, src) => {
  const o = {
    text: data.d.text,
    $t: getType(data.t)
  };

  switch (data.t) {
    case "Flow":
      o.id = data.id;
      o.name = o.text;
      delete o.text;
      break;
    case "Statement":
      o.id = [data.id, ob.id].join("$");
      Object.entries(data.d).forEach(([k, v]) => {
        if (v) o[k] = v;
      });
      break;
    case "Response":
      o.id = [data.id, ob.id].join("$");
      // o.flag = data.d.flag;
      Object.entries(data.d).forEach(([k, v]) => {
        if (v) o[k] = v;
      });
      break;
    case "Portal":
      o.id = data.d.flowId;

      let path;
      try {
        path = `in/${authority}/${o.id}.json`;
        // console.log({ path });
        const { name } = JSON.parse(fs.readFileSync(path));
        o.text = name;
        // console.log({ name });
      } catch (e) {
        console.log(`no ${path}`);
        o.text = "?? portal";
      }

      break;
    default:
      throw "not found";
  }

  const { id } = o;

  delete o.id;

  if (id !== ob.id) {
    ob.nodes[id] = o;
    ob.edges.push({ src, tgt: id });
  }

  if (data.c && data.c.length > 0) {
    data.c.map(child =>
      // parseToImport(
      //   child,
      //   ob,
      //   id === [ob.id, ob.id].join("$") ? undefined : id
      // )
      parseToImport(child, ob, id === ob.id ? undefined : id)
    );
  }

  return ob;
};

fs.readdirSync("in")
  .filter(f => f.endsWith(".json"))
  .forEach(async la => {
    const ids = JSON.parse(fs.readFileSync(`in/${la}`));
    // const files = fs.readdirSync(`in/${la}/${la}`);
    for (let id of ids) {
      const json = JSON.parse(
        fs.readFileSync(`in/${la.split(".")[0]}/${id}.json`)
      );

      const parsed = parseToImport(
        json.data,
        { id, name: json.data.d.text, nodes: {}, edges: [] },
        null
      );

      try {
        fs.mkdirSync("out");
      } catch (e) {}

      fs.writeFileSync(`out/${id}.json`, JSON.stringify(parsed));

      // await axios.post("http://localhost/flows", parsed);
    }
  });

const ob = {
  id: v4(),
  name: "Root",
  nodes: {},
  edges: new Set()
};

const aIds = JSON.parse(fs.readFileSync(`in/${authority}.json`)).reverse();
aIds.forEach(async id => {
  const data = JSON.parse(fs.readFileSync(`out/${id}.json`));
  ob.nodes = { ...ob.nodes, ...data.nodes };
  data.edges.forEach(e => {
    const src = id === aIds[0] ? undefined : e.src || id;

    ob.edges.add({ src, ...e });
    // ob.edges.add(e);
    // ob.edges.add([e.src || undefined, e.tgt]);
  });
});

// ob.edges = uniqBy([...ob.edges], x => JSON.stringify(x));
ob.edges = [...ob.edges];

ob.nodes = Object.entries(ob.nodes).reduce((acc, [k, v]) => {
  // if (v.type === 300 || v.type === 0) {
  //   acc[k] = v;
  // } else {
  allIds[k] = allIds[k] || generatePushID();
  acc[allIds[k]] = v;
  // }
  return acc;
}, {});

ob.edges = ob.edges.reduce((acc, e) => {
  acc.push({
    src: allIds[e.src],
    tgt: allIds[e.tgt]
  });
  return acc;
}, []);

fs.writeFileSync("out.json", JSON.stringify(ob));
axios.post("http://localhost:8888/flows", ob);

console.log(`http://localhost:1234/${ob.id}`);
