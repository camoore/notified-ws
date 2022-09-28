import "dotenv/config";
import { OpenSeaStreamClient, EventType, Network } from "@opensea/stream-js";
import { WebSocket } from "ws";
import { getNotifications } from "./mongo/index.js";
import { mongoose } from "mongoose";
import axios from "axios";
import cron from "node-cron";

let rateLimited = false;

axios.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    if (error.response.status === 429) {
      rateLimited = true;
      console.log(
        "Rate limit exceeded, waiting...",
        error.response.headers["retry-after"]
      );

      console.log(rateLimited);
      return new Promise(
        (resolve) =>
          setTimeout(() => {
            rateLimited = false;
            resolve(error);
          }),
        error.response.headers["retry-after"] * 1000
      );
    }
    return Promise.reject(error);
  }
);

const MONGOOSE_URI = process.env.MONGOOSE_URI,
  OPENSEA_API_KEY = process.env.OPENSEA_API_KEY,
  WS_URL = process.env.WS_URL,
  client = new OpenSeaStreamClient({
    network: Network.MAINNET,
    apiUrl: WS_URL,
    token: OPENSEA_API_KEY,
    onError: console.error,
    connectOptions: {
      transport: WebSocket,
    },
  });

let notifications = [],
  contracts = [];

(async () => {
  await mongoose.connect(MONGOOSE_URI);
  notifications = await getNotifications();
  let events = [];

  cron.schedule("*/1 * * * *", async () => {
    let i = events.length;
    console.log("Pre Events: ", events);
    while (i--) {
      await axios.post(`${process.env.DISCORD_HOOK}`, {
        content: `${events[i]}`,
      });

      events.splice(i, 1);
    }
    console.log("Post Events: ", events);
  });

  contracts = notifications.map((notification) => {
    return notification.contract;
  });

  client.onEvents("*", [EventType.ITEM_LISTED], async (item) => {
    try {
      if (item.payload.is_private) return;

      let contract = item.payload.item.permalink.split("/")[5];
      if (contracts.includes(contract)) {
        let matches = notifications.filter(
          (notification) => notification.contract == contract
        );
        let listPrice =
          item.payload.base_price /
          Math.pow(10, item.payload.payment_token.decimals);
        matches.forEach((notification) => {
          if (listPrice < notification.price) {
            console.dir(item, { depth: null });
            events.push(`${contract}: ${listPrice}`);
          }
        });

        console.log("Found Match: ", contract);
      }
    } catch (error) {
      console.log("Got Error");
      console.dir(error, { depth: null });
    }
  });
})();
