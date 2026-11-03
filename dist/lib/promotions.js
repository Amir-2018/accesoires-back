export const promotionSelect = {
    id: true,
    slug: true,
    title: true,
    discountPercent: true,
    startDate: true,
    endDate: true,
    isActive: true,
};
export function utcToday(now = new Date()) {
    const date = now.toISOString().slice(0, 10);
    return new Date(`${date}T00:00:00.000Z`);
}
export function isPromotionInDateRange(promotion, now = new Date()) {
    if (!promotion.isActive)
        return false;
    const today = utcToday(now).getTime();
    return promotion.startDate.getTime() <= today && promotion.endDate.getTime() >= today;
}
export function discountedUnitPrice(price, discountPercent) {
    return Math.round(price * (1 - discountPercent / 100) * 1000) / 1000;
}
export function dateOnly(value) {
    return new Date(`${value}T00:00:00.000Z`);
}
export function activePromotionWhere(today) {
    return { isActive: true, startDate: { lte: today }, endDate: { gte: today } };
}
export function articlePromotionFilter(slug, today) {
    return { promotion: { is: { slug, ...activePromotionWhere(today) } } };
}
