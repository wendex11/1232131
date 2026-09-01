export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    // Проверяем наличие API-ключа
    if (!env.OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({
          error: "OPENAI_API_KEY не настроен в Cloudflare"
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        }
      );
    }

    const body = await request.json();
    const imageDataUrl = body?.image;

    if (!imageDataUrl || typeof imageDataUrl !== "string") {
      return new Response(
        JSON.stringify({
          error: "Изображение не передано"
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        }
      );
    }

    const allowedItems = [
      "Кофе",
      "Помидор",
      "Молоко",
      "Гипс",
      "Железо",
      "Реагенты",
      "Аммиак",
      "Остатки приборов шепота",
      "Отличная тушенка",
      "Газовый баллон",
      "Перчатки",
      "Чеснок",
      "Поташ",
      "Мясо шавки",
      "Мясо кабана",
      "Мясо хрюши"
    ];

    const prompt = `
Ты распознаёшь предметы на скриншоте инвентаря игры.

Нужно определить ТОЛЬКО предметы из разрешённого списка.

Разрешённые предметы:
${allowedItems.map((item) => `- ${item}`).join("\n")}

Правила:
1. Найди все предметы из этого списка, которые видны на изображении.
2. Определи количество каждого предмета.
3. Если один и тот же предмет встречается несколько раз, объедини количество.
4. Не добавляй предметы, которых нет в разрешённом списке.
5. Игнорируй неизвестные предметы.
6. Не вычисляй стоимость.
7. Не добавляй пояснения.
8. Верни только JSON по заданной схеме.
`;

    const openaiResponse = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-5",
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: prompt
                },
                {
                  type: "input_image",
                  image_url: imageDataUrl,
                  detail: "high"
                }
              ]
            }
          ],
          text: {
            format: {
              type: "json_schema",
              name: "inventory_recognition",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        name: {
                          type: "string",
                          enum: allowedItems
                        },
                        quantity: {
                          type: "integer",
                          minimum: 0
                        },
                        confidence: {
                          type: "number",
                          minimum: 0,
                          maximum: 1
                        }
                      },
                      required: [
                        "name",
                        "quantity",
                        "confidence"
                      ]
                    }
                  }
                },
                required: ["items"]
              }
            }
          }
        })
      }
    );

    const resultText = await openaiResponse.text();

    if (!openaiResponse.ok) {
      return new Response(
        JSON.stringify({
          error: "Ошибка OpenAI API",
          details: resultText
        }),
        {
          status: openaiResponse.status,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        }
      );
    }

    const result = JSON.parse(resultText);

    // Responses API может вернуть текст в output
    let parsed;

    try {
      const outputText =
        result.output_text ||
        result.output
          ?.flatMap((item) => item.content || [])
          ?.find((content) => content.type === "output_text")
          ?.text;

      parsed = JSON.parse(outputText || '{"items":[]}');
    } catch {
      parsed = { items: [] };
    }

    // Дополнительная защита: оставляем только разрешённые предметы
    const items = Array.isArray(parsed.items)
      ? parsed.items
          .filter(
            (item) =>
              item &&
              allowedItems.includes(item.name) &&
              Number.isFinite(Number(item.quantity))
          )
          .map((item) => ({
            name: item.name,
            quantity: Math.max(0, Math.floor(Number(item.quantity))),
            confidence: Math.max(
              0,
              Math.min(1, Number(item.confidence) || 0)
            )
          }))
      : [];

    return new Response(
      JSON.stringify({ items }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        }
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Ошибка обработки изображения",
        details: error?.message || String(error)
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        }
      }
    );
  }
}