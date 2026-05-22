export function calculatePayPalSurcharge(bidAmount: number) {
  const percentRate = 0.0349;
  const fixedFee = 0.49;
  const totalInvoiceAmount = (bidAmount + fixedFee) / (1 - percentRate);
  
  const roundedTotal = Math.round(totalInvoiceAmount * 100) / 100;
  const surchargeAmount = Math.round((roundedTotal - bidAmount) * 100) / 100;
  
  return {
    total: roundedTotal,
    surcharge: surchargeAmount
  };
}
