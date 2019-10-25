const fs = require("fs").promises;
const axios = require("axios");
const { v4 } = require("uuid");
const rimraf = require("rimraf");
const cors = require("cors");

const ids = {
  lambeth: "9ef6746e-1525-44d5-9622-a9759a4f971a",
  southwark: "4733c885-454c-452b-8803-0a7237b43b3a",
  wycombe: "2ca357cc-1b4a-47a2-942b-fa1aa5002c9b"
};

// const authority = "southwark";

async function one(authority) {
  rimraf.sync(`in/${authority}`);
  rimraf.sync(`out/${authority}`);

  try {
    await fs.mkdir("in");
  } catch (e) {}

  // let ids2 = Object.entries(ids);
  // let ids2 = [ids[authority]];

  // let id2 = ids[authority]

  // for (let id2 of ids2) {
  const [la, id] = [authority, ids[authority]];

  let arr = [id];
  const visited = new Set();

  const parse = (nodes = [], arr = []) => {
    nodes.forEach(n => {
      if (n.t === "Portal") arr.push(n.d.flowId);
      parse(n.c, arr);
    });

    return arr;
  };

  const get = async id => {
    if (id && !visited.has(id)) {
      visited.add(id);
      const url = `https://planx-backend.herokuapp.com/api/v1/flows/${id}`;
      console.log(id);

      const { data } = await axios.get(url);
      const ids = parse(data.data.c, arr);

      await Promise.all(ids.map(get));
    }
  };

  const main = async () => {
    await get(arr[0]);
    await fs.writeFile(
      `in/${la}.json`,
      JSON.stringify(Array.from(new Set(arr)).reverse(), null, 2)
    );
  };

  await main();
  // }

  return 1;
}

async function two(authority) {
  // let files = await fs.readdir("in");
  // files = files.filter(f => f.endsWith(".json"));

  // for (let f of files) {
  const file = await fs.readFile(`in/${authority}.json`);
  const ids = JSON.parse(file);
  const dir = `in/${authority}`;

  try {
    await fs.mkdir(dir);
  } catch (e) {}

  for (let id of ids) {
    const url = `https://planx-backend.herokuapp.com/api/v1/flows/${id}.json`;
    const { data } = await axios.get(url);

    await fs.writeFile(`${dir}/${id}.json`, JSON.stringify(data));
  }
  // }

  return 1;
}

async function three(authority) {
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

  const parseToImport = async (data, ob, src) => {
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
          const fi = await fs.readFile(path);
          const { name } = JSON.parse(fi);
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
      for (let child of data.c.slice()) {
        const c = await parseToImport(child, ob, id === ob.id ? undefined : id);
        data.c.push(c);
      }
      // data.c.map(async child =>
      //   // parseToImport(
      //   //   child,
      //   //   ob,
      //   //   id === [ob.id, ob.id].join("$") ? undefined : id
      //   // )
      //   await parseToImport(child, ob, id === ob.id ? undefined : id)
      // );
    }

    return ob;
  };

  let xyz = await fs.readdir("in");
  xyz = xyz.filter(f => f.endsWith(".json"));
  for (let la of xyz) {
    const fff = await fs.readFile(`in/${la}`);
    const ids = JSON.parse(fff);

    // const files = fs.readdirSync(`in/${la}/${la}`);
    for (let id of ids) {
      const f3 = await fs.readFile(`in/${la.split(".")[0]}/${id}.json`);
      const json = JSON.parse(f3);

      const parsed = await parseToImport(
        json.data,
        { id, name: json.data.d.text, nodes: {}, edges: [] },
        null
      );

      try {
        await fs.mkdir("out");
        await fs.mkdir(`out/${authority}`);
      } catch (e) {}

      await fs.writeFile(`out/${authority}/${id}.json`, JSON.stringify(parsed));

      // await axios.post("http://localhost/flows", parsed);
    }
  }

  const ob = {
    id: v4(),
    name: "Root",
    nodes: {},
    edges: new Set()
  };

  const fff = await fs.readFile(`in/${authority}.json`);

  const aIds = JSON.parse(fff).reverse();

  for (let id of aIds) {
    const f1 = await fs.readFile(`out/${authority}/${id}.json`);
    const data = JSON.parse(f1);
    ob.nodes = { ...ob.nodes, ...data.nodes };
    data.edges.forEach(e => {
      const src = id === aIds[0] ? undefined : e.src || id;

      ob.edges.add({ src, ...e });
      // ob.edges.add(e);
      // ob.edges.add([e.src || undefined, e.tgt]);
    });
  }

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

  return ob;
}
// ----

// -----

const express = require("express");
const app = express();
app.use(cors());

const port = 3000;

app.get("/:cacheBuster/:team", async (req, res) => {
  const { team } = req.params;
  await one(team);
  await two(team);
  const ob = await three(team);
  res.json(ob);
});

app.listen(port, () => console.log(`Example app listening on port ${port}!`));
