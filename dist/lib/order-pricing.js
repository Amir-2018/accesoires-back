import { HttpError } from "./http.js";
import { discountedUnitPrice, isPromotionInDateRange } from "./promotions.js";
export function calculateOrderPricing(requestedItems, articles) {
    if (articles.length !== requestedItems.length)
        throw new HttpError(400, "Un article demandé est introuvable.");
    const items = requestedItems.map((requested) => {
        const article = articles.find((candidate) => candidate.id === requested.articleId);
        if (!article)
            throw new HttpError(400, "Un article demandé est introuvable.");
        const promotion = article.promotion && isPromotionInDateRange(article.promotion) ? article.promotion : null;
        const discountPercent = promotion?.discountPercent ?? 0;
        return {
            articleId: article.id,
            nom: article.nom,
            prix: discountedUnitPrice(article.prix, discountPercent),
            prixOriginal: article.prix,
            discountPercent,
            promotionSlug: promotion?.slug ?? null,
            quantite: requested.quantite,
        };
    });
    const subtotal = Math.round(items.reduce((sum, item) => sum + item.prixOriginal * item.quantite, 0) * 1000) / 1000;
    const total = Math.round(items.reduce((sum, item) => sum + item.prix * item.quantite, 0) * 1000) / 1000;
    return { items, subtotal, total, discountTotal: Math.round((subtotal - total) * 1000) / 1000 };
}
