const puppeteer = require("puppeteer");
const { Storage } = require("@google-cloud/storage");
const https = require("https");

const { BUCKET_NAME, OAUTH_ACCESS_TOKEN } = process.env;
const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

module.exports.googleFinanceBot = async (req, res) => {
  try {
    console.log("========================");
    console.log("body:", req.body);

    if (req.body.challenge) {
      res.status(200).send(req.body.challenge);
      return;
    }

    const {
      event: { client_msg_id, text, channel },
    } = req.body;

    const fileName = `${client_msg_id}.png`;
    const file = bucket.file(fileName);

    if ((await file.exists())[0]) {
      console.log("already processing");
      res.sendStatus(200);
      return;
    }

    console.log("start processing -------------");

    await file.save("");
    await new Promise(resolve => setTimeout(resolve, 5000));

    const result = /(.*)<@\S+>(.*)/.exec(text);
    if (!result) {
      throw new Error("bad text");
    }
    const [_, $1, $2] = result;
    const query = `${$1} ${$2}`;
    console.log("query:", query);

    const { title, subtitle, png } = await capture(query);

    console.log("save file to:", BUCKET_NAME, fileName);
    await file.save(png, { contentType: "image/png", public: true });

    const postData = JSON.stringify({
      channel,
      attachments: [
        {
          title,
          text: subtitle,
          image_url: `https://storage.googleapis.com/${BUCKET_NAME}/${fileName}`,
        },
      ],
    });
    console.log("post:", postData);
    const r = https.request(
      {
        method: "post",
        hostname: "slack.com",
        path: "/api/chat.postMessage",
        headers: {
          Authorization: `Bearer ${OAUTH_ACCESS_TOKEN}`,
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(postData),
        },
      },
      res => {
        console.log(`STATUS: ${res.statusCode}`);
        console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
        res.setEncoding("utf8");
        res.on("data", chunk => {
          console.log(`BODY: ${chunk}`);
        });
        res.on("end", () => {
          console.log("No more data in response.");
        });
      },
    );
    r.on("error", e => {
      console.error(`problem with request: ${e.message}`);
    });
    r.write(postData);
    r.end();

    res.status(200).send("OK");
  } catch (err) {
    console.log("error:", err);
    res.status(500).send(err.toString());
  }
};

async function capture(query) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();

  console.log("goto:", query);

  await page.goto(`https://www.google.co.jp/search?tbm=fin&q=${query}`, {
    waitUntil: "domcontentloaded",
    timeout: 5000,
  });
  // await page.waitFor("[data-attrid='title']", { timeout: 60000 });

  const title = await page.$eval("[data-attrid='title']", el => el.textContent);
  const subtitle = await page.$eval(
    "[data-attrid='subtitle']",
    el => el.textContent,
  );

  console.log("elements:", title, subtitle);

  const selector = "#knowledge-finance-wholepage__entity-summary";
  const clip = await page.evaluate(selector => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }, selector);

  if (!clip) {
    throw Error(`Could not find element that matches selector: ${selector}.`);
  }
  console.log("clip:", clip);
  const png = await page.screenshot({ clip });
  await browser.close();

  return {
    title,
    subtitle,
    png,
  };
}

// (async () => {
//   const { title, subtitle, png } = await capture("zozo");
//   console.log(title, subtitle, png);
// })();
