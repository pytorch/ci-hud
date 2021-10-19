import { groups as pytorch } from "./pytorch.js";
import { groups as vision } from "./vision.js";
import { groups as audio } from "./audio.js";
import { groups as text } from "./text.js";
import { groups as lightning } from "./pytorch-lightning.js";

const map = {
  pytorch: pytorch,
  vision: vision,
  audio: audio,
  text: text,
  "pytorch-lightning": lightning,
};

export default function getGroups(repo) {
  const result = [];
  if (!map[repo]) {
    console.error(`Unknown group repo ${repo}`);
    return [];
  }

  for (const group of map[repo]) {
    let obj = {};
    Object.assign(obj, group);
    result.push(obj);
  }

  return result;
}
