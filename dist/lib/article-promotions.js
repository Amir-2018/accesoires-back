import { HttpError } from "./http.js";
export async function assertPromotionExists(promotionId, findPromotion) {
    if (promotionId && !(await findPromotion(promotionId))) {
        throw new HttpError(400, "Cette promotion n’existe pas.");
    }
}
