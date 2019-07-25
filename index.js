const puppeteer = require("puppeteer");
const { Storage } = require("@google-cloud/storage");
const request = require("request-promise-native");

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

    console.log("save file as:", BUCKET_NAME, fileName);
    await file.save(png, { contentType: "image/png", public: true });

    const postData = {
      channel,
      attachments: [
        {
          title,
          text: subtitle,
          image_url: `https://storage.googleapis.com/${BUCKET_NAME}/${fileName}`,
        },
      ],
    };
    console.log("post:", postData);
    const r = await request.post({
      url: "https://slack.com/api/chat.postMessage",
      headers: {
        Authorization: `Bearer ${OAUTH_ACCESS_TOKEN}`,
        // "Content-Type": "application/json; charset=utf-8",
        // "Content-Length": Buffer.byteLength(postData),
      },
      body: postData,
      json: true,
    });

    console.log(`STATUS: ${r.statusCode}`);
    console.log(`HEADERS: ${JSON.stringify(r.headers)}`);
    // res.setEncoding("utf8");
    // res.on("data", chunk => {
    //   console.log(`BODY: ${chunk}`);
    // });
    // res.on("end", () => {
    //   console.log("No more data in response.");
    // });
    // r.on("error", e => {
    //   console.error(`problem with request: ${e.message}`);
    // });
    // r.write(postData);
    // r.end();

    res.status(200).send("OK");
  } catch (err) {
    console.log("error:", err);
    res.status(500).send(err.toString());
  }
};

async function capture(query) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "-–disable-dev-shm-usage",
      // "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--lang=ja-JP",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({
    width: 640,
    height: 480,
    deviceScaleFactor: 2,
  });
  await page.setExtraHTTPHeaders({
    "Accept-Language": "ja-JP",
  });
  const headlessUserAgent = await page.evaluate(() => navigator.userAgent);
  const chromeUserAgent = headlessUserAgent.replace("HeadlessChrome", "Chrome");
  console.log("UserAgent:", chromeUserAgent);
  await page.setUserAgent(chromeUserAgent);
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "language", {
      get: function() {
        return ["ja-JP"];
      },
    });
    Object.defineProperty(navigator, "languages", {
      get: function() {
        return ["ja-JP", "ja"];
      },
    });
  });

  const url = `https://www.google.co.jp/search?hl=ja&tbm=fin&q=${query}`;
  console.log("goto:", url);
  for (let i = 0; i < 10; i++) {
    try {
      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: 3000,
      });
      break;
    } catch (err) {
      // ignore
    }
  }

  await page.waitFor("[data-attrid='title']", { timeout: 10000 });
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
//   console.log(title, subtitle);
//   require("fs").writeFileSync("capture.png", png);
// })();
