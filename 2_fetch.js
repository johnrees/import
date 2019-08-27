const fs = require("fs");
const axios = require("axios");

fs.readdirSync("in")
  .filter(f => f.endsWith(".json"))
  .forEach(f => {
    const ids = JSON.parse(fs.readFileSync(`in/${f}`));
    const la = f.split(".")[0];
    const dir = `in/${la}`;

    try {
      fs.mkdirSync(dir);
    } catch (e) {}

    ids.forEach(async id => {
      const url = `https://planx-backend.herokuapp.com/api/v1/flows/${id}.json`;
      const { data } = await axios.get(url);

      fs.writeFileSync(`${dir}/${id}.json`, JSON.stringify(data));
    });
  });
