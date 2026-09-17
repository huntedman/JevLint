interface Thing {
  a: string;
  b: string;
  c: number;
  d: number;
}

interface Stuff {
  data: Thing[];
  x: string;
}

export function doStuff({ data, x }: Stuff) {
  let tmp = 0;
  const arr = [];

  for (const v of data) {
    if (v.b === "cancelled") continue;

    let n = v.c * v.d;

    if (x === "premium") n *= 0.9;

    let s = "pending";

    if (n >= 100) s = "ready-for-processing";

    tmp += n;
    arr.push({ x: v.a, y: s, z: n });
  }

  return { stuff: arr, num: Math.round(tmp * 100) / 100 };
}
