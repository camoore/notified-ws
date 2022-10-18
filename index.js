import "dotenv/config";
import { OpenSeaStreamClient, EventType, Network } from "@opensea/stream-js";
import { WebSocket } from "ws";
import { getNotifications } from "./mongo/index.js";
import { mongoose } from "mongoose";
import axios from "axios";
import cron from "node-cron";

let rateLimited = false;


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
    events = [
      ...new Map(events.map((item) => [item.identifier, item])).values(),
    ];
    let i = events.length;
    console.log("Pre Events: ", events);
    while (i--) {
      await axios.post(`${process.env.DISCORD_HOOK}`, {
        content: `${events[i].msg}`,
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
        let listPrice = getPrice(item);
        notifications.forEach((notification) => {
          if (
            notification.contract == contract &&
            listPrice.tokenPrice < notification.price
          ) {
            events.push({
              identifier: `${notification._id}`,
              msg: `${contract}: ${listPrice.tokenPrice}`,
              listPrice,
              ...item,
              ...notification,
            });
          }
        });
      }
    } catch (error) {
      console.log("Got Error");
      console.dir(error, { depth: null });
    }
  });
})();

function getPrice(item) {
  let tokenPrice =
    item.payload.base_price / Math.pow(10, item.payload.payment_token.decimals);

  return {
    token: item.payload.payment_token.symbol,
    tokenPrice,
    usdPrice: tokenPrice * item.payload.payment_token.usd_price,
  };
}
