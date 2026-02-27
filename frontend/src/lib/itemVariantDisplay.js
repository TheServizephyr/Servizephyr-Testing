const cleanText = (value) => String(value || '').trim();

const isFullLabel = (value) => cleanText(value).toLowerCase() === 'full';

const getRawVariantLabel = (item = {}) => {
    const label =
        item?.portion?.name ||
        item?.selectedPortion?.name ||
        item?.variant ||
        item?.portionName ||
        item?.size ||
        '';
    return cleanText(label);
};

export const shouldShowItemVariant = (item = {}) => {
    const selectedLabel = getRawVariantLabel(item);

    if (!selectedLabel) return false;
    if (!isFullLabel(selectedLabel)) return true;
    if (item?.portion?.isDefault === true) return false;
    if (item?.selectedPortion?.isDefault === true) return false;

    const explicitPortionCount = Number(
        item?.portionCount ??
        item?.portion?.count ??
        (Array.isArray(item?.portions) ? item.portions.length : 0)
    );

    if (Number.isFinite(explicitPortionCount) && explicitPortionCount > 1) return true;

    const hasNonFullPortion = Array.isArray(item?.portions) &&
        item.portions.some((portion) => !isFullLabel(portion?.name));

    return !!hasNonFullPortion;
};

export const getItemVariantLabel = (item = {}) => {
    const selectedLabel = getRawVariantLabel(item);

    if (!selectedLabel) return '';
    if (!shouldShowItemVariant(item)) return '';

    return ` (${selectedLabel})`;
};
