import assert from "node:assert/strict";
import test from "node:test";
import { articlePromotionFilter, discountedUnitPrice, isPromotionInDateRange, utcToday } from "./promotions.js";
import { articleInput } from "../routes/articles.js";
import { promotionAdminPatchInput, promotionInput } from "../routes/promotions.js";
import { promotionSlugFromTitle } from "./promotion-slug.js";
import { requireRoles } from "../middleware/auth.js";
import { HttpError } from "./http.js";
import { assertPromotionExists } from "./article-promotions.js";
import { calculateOrderPricing } from "./order-pricing.js";

const validPromotion = {
  title: "Un éclat au quotidien",
  discountPercent: 20,
  startDate: "2026-11-03",
  endDate: "2026-11-30",
};

test("promotion input validates only the four business fields and date range", () => {
  assert.equal(promotionInput.safeParse(validPromotion).success, true);
  for (const discountPercent of [15, 50, 70]) {
    assert.equal(promotionInput.safeParse({ ...validPromotion, discountPercent }).success, true);
  }
  assert.equal(promotionInput.safeParse({ ...validPromotion, discountPercent: 101 }).success, false);
  assert.equal(promotionInput.safeParse({ ...validPromotion, endDate: "2026-11-02" }).success, false);
  assert.equal(promotionInput.safeParse({ ...validPromotion, slug: "client-slug" }).success, false);
  assert.equal(promotionInput.safeParse({ ...validPromotion, discountPercent: 20.5 }).success, false);
  assert.equal(promotionAdminPatchInput.safeParse({ isActive: false }).success, true);
  assert.equal(promotionAdminPatchInput.safeParse({ isActive: "false" }).success, false);
});

test("promotion slugs are generated from titles and support accents", () => {
  assert.equal(promotionSlugFromTitle("Les détails qui changent tout"), "les-details-qui-changent-tout");
  assert.equal(promotionSlugFromTitle("!!!"), "promotion");
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

test("15%, 50%, and 70% promotions use the stored percentage for unit and order totals", () => {
  const rates = [
    { discountPercent: 15, unitPrice: 296.65, totalForTwo: 593.3, discountForTwo: 104.7 },
    { discountPercent: 50, unitPrice: 174.5, totalForTwo: 349, discountForTwo: 349 },
    { discountPercent: 70, unitPrice: 104.7, totalForTwo: 209.4, discountForTwo: 488.6 },
  ];

  for (const { discountPercent, unitPrice, totalForTwo, discountForTwo } of rates) {
    assert.equal(discountedUnitPrice(349, discountPercent), unitPrice);

    for (const quantite of [1, 2]) {
      const pricing = calculateOrderPricing(
        [{ articleId: `a-${discountPercent}`, quantite }],
        [{
          id: `a-${discountPercent}`,
          nom: `${discountPercent}% article`,
          prix: 349,
          promotion: {
            slug: `offer-${discountPercent}`,
            discountPercent,
            startDate: new Date("2026-11-04T00:00:00.000Z"),
            endDate: new Date("2026-11-30T00:00:00.000Z"),
            isActive: true,
          },
        }],
        new Date("2026-11-04T12:00:00.000Z"),
      );

      assert.equal(pricing.items[0].discountPercent, discountPercent);
      assert.equal(pricing.items[0].prix, unitPrice);
      assert.equal(pricing.total, quantite === 1 ? unitPrice : totalForTwo);
      assert.equal(pricing.discountTotal, quantite === 1 ? Math.round((349 - unitPrice) * 1000) / 1000 : discountForTwo);
    }
  }

  assert.equal(discountedUnitPrice(349, 20), 279.2);
  assert.equal(discountedUnitPrice(100, 15), 85);
  assert.equal(discountedUnitPrice(10, 33), 6.7);
});

test("promotion filtering scopes article queries to inclusive UTC dates", () => {
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

test("order price snapshots match frontend discounts and exclude out-of-period promotions", () => {
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
          endDate: new Date("2026-10-31T00:00:00.000Z"),
          isActive: true,
        },
      },
    ],
    new Date("2026-11-04T12:00:00.000Z"),
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
