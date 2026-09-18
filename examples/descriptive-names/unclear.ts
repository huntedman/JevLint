interface Invoice {
  invoiceId: string;
  isOverdue: boolean;
  outstandingAmount: number;
}

export function doStuff(data: Invoice[]) {
  const tmp = data.filter((x) => x.isOverdue);
  return {
    things: tmp.map((x) => x.invoiceId),
    num: tmp.reduce((a, b) => a + b.outstandingAmount, 0),
  };
}
