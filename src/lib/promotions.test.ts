import assert from "node:assert/strict";
import test from "node:test";
import { articlePromotionFilter, discountedUnitPrice, isPromotionInDateRange, utcToday } from "./promotions.js";
import { articleInput } from "../routes/articles.js";
import { promotionImageSchema, promotionInput } from "../routes/promotions.js";
import { requireRoles } from "../middleware/auth.js";
import { HttpError } from "./http.js";
import { assertPromotionExists } from "./article-promotions.js";
import { calculateOrderPricing } from "./order-pricing.js";

const validPromotion = {
  slug: "eclat-au-quotidien",
  discountPercent: 20,
  badge: "-20%",
  kicker: "Une offre",
  title: "Un éclat au quotidien",
  description: "Une sélection à découvrir.",
  image: "https://example.com/promotion.jpg",
  imageAlt: "Bijoux dorés",
  detailTitle: "Votre éclat",
  detailDescription: "Des bijoux à porter tous les jours.",
  highlights: ["20 % sur la sélection"],
  startDate: "2026-11-03",
  endDate: "2026-11-30",
  isActive: true,
};

test("promotion input validates dates, discount, URL, and non-empty highlights", () => {
  assert.equal(promotionInput.safeParse(validPromotion).success, true);
  assert.equal(promotionInput.safeParse({ ...validPromotion, discountPercent: 101 }).success, false);
  assert.equal(promotionInput.safeParse({ ...validPromotion, endDate: "2026-11-02" }).success, false);
  assert.equal(promotionInput.safeParse({ ...validPromotion, image: "javascript:alert(1)" }).success, false);
  assert.equal(promotionInput.safeParse({ ...validPromotion, highlights: [" "] }).success, false);
});

test("promotion images accept local image uploads and reject unsupported or oversized data", () => {
  assert.equal(promotionImageSchema.safeParse("data:image/png;base64,AQ==").success, true);
  assert.equal(promotionImageSchema.safeParse("https://example.com/promotion.jpg").success, true);
  assert.equal(promotionImageSchema.safeParse("data:image/svg+xml;base64,PHN2Zz4=").success, false);
  assert.equal(promotionImageSchema.safeParse(`data:image/png;base64,${"A".repeat(8_388_612)}`).success, false);
});

test("promotion validity includes both date endpoints in UTC", () => {
  const promotion = {
    startDate: new Date("2026-11-03T00:00:00.000Z"),
    endDate: new Date("2026-11-03T00:00:00.000Z"),
    isActive: true,
  };
  assert.equal(isPromotionInDateRange(promotion, new Date("2026-11-03T23:59:59.999Z")), true);
  assert.equal(isPromotionInDateRange(promotion, new Date("2026-11-04T00:00:00.000Z")), false);
  assert.equal(isPromotionInDateRange({ ...promotion, isActive: false }, new Date("2026-11-03T12:00:00.000Z")), false);
});

test("discount calculation matches the shop's three-decimal unit-price rule", () => {
  assert.equal(discountedUnitPrice(349, 20), 279.2);
  assert.equal(discountedUnitPrice(10, 33), 6.7);
});

test("promotion filtering scopes article queries to active offers and inclusive UTC dates", () => {
  const where = articlePromotionFilter("eclat-au-quotidien", utcToday(new Date("2026-11-03T23:59:59.000Z")));
  assert.deepEqual(where, {
    promotion: {
      is: {
        slug: "eclat-au-quotidien",
        isActive: true,
        startDate: { lte: new Date("2026-11-03T00:00:00.000Z") },
        endDate: { gte: new Date("2026-11-03T00:00:00.000Z") },
      },
    },
  });
});

test("article promotion association accepts a cleared value and rejects an unknown promotion", async () => {
  const article = {
    id: "article-1",
    nom: "Article",
    image: "https://example.com/article.jpg",
    description: "Description",
    prix: 100,
    stock: 1,
    categorie: "Accessoires",
    promotionId: null,
  };
  assert.equal(articleInput.safeParse(article).success, true);
  assert.equal(articleInput.safeParse({ ...article, promotionId: "promotion-1" }).success, true);
  await assertPromotionExists(null, async () => null);
  await assert.rejects(assertPromotionExists("missing", async () => null), (error: unknown) =>
    error instanceof HttpError && error.status === 400,
  );
  await assertPromotionExists("promotion-1", async (id) => ({ id }));
});

test("order price snapshots match frontend discounts and exclude inactive promotions", () => {
  const pricing = calculateOrderPricing(
    [{ articleId: "a-discount", quantite: 3 }, { articleId: "a-inactive", quantite: 2 }],
    [
      {
        id: "a-discount",
        nom: "Discounted",
        prix: 10,
        promotion: {
          slug: "offer-33",
          discountPercent: 33,
          startDate: new Date("2026-11-01T00:00:00.000Z"),
          endDate: new Date("2026-11-30T00:00:00.000Z"),
          isActive: true,
        },
      },
      {
        id: "a-inactive",
        nom: "Regular",
        prix: 5,
        promotion: {
          slug: "inactive",
          discountPercent: 50,
          startDate: new Date("2026-11-01T00:00:00.000Z"),
          endDate: new Date("2026-11-30T00:00:00.000Z"),
          isActive: false,
        },
      },
    ],
  );
  assert.equal(pricing.subtotal, 40);
  assert.equal(pricing.total, 30.1);
  assert.equal(pricing.discountTotal, 9.9);
  assert.deepEqual(pricing.items.map(({ prix, prixOriginal, discountPercent, promotionSlug }) => ({ prix, prixOriginal, discountPercent, promotionSlug })), [
    { prix: 6.7, prixOriginal: 10, discountPercent: 33, promotionSlug: "offer-33" },
    { prix: 5, prixOriginal: 5, discountPercent: 0, promotionSlug: null },
  ]);
});

test("promotion writes require the supervisor role", () => {
  const middleware = requireRoles("supervisor");
  let receivedError: unknown;
  let passed = false;
  middleware({ auth: { userId: "agent-1", role: "agent" } } as never, {} as never, (error?: unknown) => {
    receivedError = error;
  });
  assert.ok(receivedError instanceof HttpError);
  assert.equal((receivedError as HttpError).status, 403);

  middleware({ auth: { userId: "supervisor-1", role: "supervisor" } } as never, {} as never, (error?: unknown) => {
    passed = error === undefined;
  });
  assert.equal(passed, true);
});
