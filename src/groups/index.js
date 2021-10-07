import { groups as pytorch } from "./pytorch.js";
import { groups as vision } from "./vision.js";

const map = {
  pytorch: pytorch,
  vision: vision,
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
