import { HttpError } from "./http.js";

export async function assertPromotionExists(
  promotionId: string | null | undefined,
  findPromotion: (id: string) => Promise<{ id: string } | null>,
): Promise<void> {
  if (promotionId && !(await findPromotion(promotionId))) {
    throw new HttpError(400, "Cette promotion n’existe pas.");
  }
}
