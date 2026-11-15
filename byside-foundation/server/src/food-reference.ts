export interface FoodReference {
  product: string;
  source: 'user-supplied-package-photo';
  basis: 'per-100g';
  nutrients: { energyKj: number; proteinG: number; fatG: number; saturatedFatG: number; carbohydrateG: number; sugarG: number; sodiumMg: number };
  allergens?: string[];
}

type Food = { name: string; certain: boolean };

// Package photos are reference data, not evidence that these foods are on the desk.
export function matchFoodReferences(description: string, foods: Food[]): FoodReference[] {
  const certain = foods.filter(food => food.certain);
  const evidence = `${description} ${certain.map(food => food.name).join(' ')}`;
  if (!certain.length || /可能|疑似|不确定|看不清|看不出|无法确认|无法辨认|不清晰/.test(evidence)) return [];
  const results: FoodReference[] = [];
  if (certain.some(food => /蛋糕/.test(food.name)) && /优乐麦/.test(evidence) && /干烙蛋糕/.test(evidence) && /恋奶味/.test(evidence)) {
    results.push({
      product: '优乐麦干烙蛋糕（恋奶味）', source: 'user-supplied-package-photo', basis: 'per-100g',
      nutrients: { energyKj: 2196, proteinG: 6.7, fatG: 26.4, saturatedFatG: 8.4, carbohydrateG: 65, sugarG: 33.9, sodiumMg: 257 },
      allergens: ['含麸质的谷物', '蛋', '乳'],
    });
  }
  if (certain.some(food => /肠/.test(food.name)) && /泡面拍档/.test(evidence) && /香肠/.test(evidence)) {
    results.push({
      product: '泡面拍档香肠', source: 'user-supplied-package-photo', basis: 'per-100g',
      nutrients: { energyKj: 689, proteinG: 12, fatG: 8.5, saturatedFatG: 3.4, carbohydrateG: 10, sugarG: 4, sodiumMg: 950 },
    });
  }
  return results;
}
