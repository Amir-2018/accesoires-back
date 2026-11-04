ALTER TABLE `article` ADD COLUMN `promotionId` VARCHAR(191) NULL;

ALTER TABLE `order`
    ADD COLUMN `discountTotal` DOUBLE NULL,
    ADD COLUMN `promotionSlug` VARCHAR(191) NULL,
    ADD COLUMN `subtotal` DOUBLE NULL,
    ADD COLUMN `totalExact` DOUBLE NULL;

ALTER TABLE `orderitem`
    ADD COLUMN `discountPercent` INTEGER NULL,
    ADD COLUMN `prixOriginal` DOUBLE NULL,
    ADD COLUMN `prixRemise` DOUBLE NULL,
    ADD COLUMN `promotionSlug` VARCHAR(191) NULL;

CREATE TABLE `Promotion` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `discountPercent` INTEGER NOT NULL,
    `badge` VARCHAR(191) NOT NULL,
    `kicker` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `image` TEXT NOT NULL,
    `imageAlt` VARCHAR(255) NOT NULL,
    `detailTitle` VARCHAR(191) NOT NULL,
    `detailDescription` TEXT NOT NULL,
    `highlights` JSON NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Promotion_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `Article_promotionId_idx` ON `article`(`promotionId`);

ALTER TABLE `article`
    ADD CONSTRAINT `Article_promotionId_fkey`
    FOREIGN KEY (`promotionId`) REFERENCES `Promotion`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
