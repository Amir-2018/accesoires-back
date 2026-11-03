import type { Promotion, Prisma } from "@prisma/client";

export const promotionSelect = {
  id: true,
  slug: true,
  title: true,
  discountPercent: true,
  startDate: true,
  endDate: true,
  isActive: true,
} satisfies Prisma.PromotionSelect;

export function utcToday(now = new Date()): Date {
  const date = now.toISOString().slice(0, 10);
  return new Date(`${date}T00:00:00.000Z`);
}

export function isPromotionInDateRange(
  promotion: Pick<Promotion, "startDate" | "endDate" | "isActive">,
  now = new Date(),
): boolean {
  if (!promotion.isActive) return false;
  const today = utcToday(now).getTime();
  return promotion.startDate.getTime() <= today && promotion.endDate.getTime() >= today;
}

export function discountedUnitPrice(price: number, discountPercent: number): number {
  return Math.round(price * (1 - discountPercent / 100) * 1000) / 1000;
}

export function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function activePromotionWhere(today: Date): Prisma.PromotionWhereInput {
  return { isActive: true, startDate: { lte: today }, endDate: { gte: today } };
}

export function articlePromotionFilter(slug: string, today: Date): Prisma.ArticleWhereInput {
  return { promotion: { is: { slug, ...activePromotionWhere(today) } } };
}
