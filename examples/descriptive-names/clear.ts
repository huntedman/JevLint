interface Invoice {
  invoiceId: string;
  isOverdue: boolean;
  outstandingAmount: number;
}

export function summarizeOverdueInvoices(invoices: Invoice[]) {
  const overdueInvoices = invoices.filter((invoice) => invoice.isOverdue);
  return {
    invoiceIds: overdueInvoices.map((invoice) => invoice.invoiceId),
    totalOutstandingAmount: overdueInvoices.reduce(
      (total, invoice) => total + invoice.outstandingAmount,
      0,
    ),
  };
}
