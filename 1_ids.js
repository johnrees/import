const fs = require("fs");
const axios = require("axios");

const ids = {
  // wycombe: "a15f27be-f63e-411a-8583-3b7170dee4ba"
  osl: "4733c885-454c-452b-8803-0a7237b43b3a"
};

module.exports = { ids };

try {
  fs.mkdirSync("in");
} catch (e) {}

Object.entries(ids).forEach(([la, id]) => {
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
    if (!visited.has(id)) {
      visited.add(id);
      const url = `https://planx-backend.herokuapp.com/api/v1/flows/${id}`;
      console.log(url);

      const { data } = await axios.get(url);
      const ids = parse(data.data.c, arr);

      await Promise.all(ids.map(get));
    }
  };

  const main = async () => {
    await get(arr[0]);
    fs.writeFileSync(
      `in/${la}.json`,
      JSON.stringify(Array.from(new Set(arr)).reverse(), null, 2)
    );
  };

  main();
});
