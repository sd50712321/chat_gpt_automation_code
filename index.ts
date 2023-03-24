import fs from "fs";
import * as path from "path";
import pdfParse from "pdf-parse";
import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";
import dotenv from "dotenv";
dotenv.config();

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

function ensureSrcFolderExists(): void {
  const srcFolderPath = path.join(".", "src");
  if (!fs.existsSync(srcFolderPath)) {
    fs.mkdirSync(srcFolderPath);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createEntityFiles(entityClasses: string[]) {
  const entitiesPath = "./src/entities";
  if (!fs.existsSync(entitiesPath)) {
    fs.mkdirSync(entitiesPath, { recursive: true });
  }

  for (const entityClass of entityClasses) {
    const className = entityClass.match(/export class (\w+)/)?.[1];
    if (!className) {
      throw new Error(
        `Failed to extract class name from the entity class:\n${entityClass}`
      );
    }

    const fileName = `${className}.ts`;
    const filePath = path.join(entitiesPath, fileName);
    fs.writeFileSync(filePath, entityClass);
  }
}

export async function createChatCompletionWithRetry(
  messages: ChatCompletionRequestMessage[],
  temperature: number
) {
  const maxRetries = 5;

  for (let retries = 0; retries < maxRetries; retries++) {
    try {
      const completions = await openai.createChatCompletion(
        {
          model: "gpt-3.5-turbo",
          messages: messages,
          temperature: temperature,
        },
        {
          timeout: 120000 * 1,
          maxBodyLength: 8192 * 40,
        }
      );

      return completions;
    } catch (error: any) {
      if (error.message.includes("timeout") && retries < maxRetries - 1) {
        console.log(`시간초과 에러 발생, 재시도: ${retries + 1}`);
      } else {
        throw error;
      }
    }
  }
}

export async function getDatabaseSchemaFromGPT(
  pdfText: string
): Promise<string> {
  const MAX_CHUNK_SIZE = 2000;
  let currentText = pdfText;
  let result = "";

  // 테스트용 변수
  while (true) {
    const isFinal = currentText.length <= MAX_CHUNK_SIZE;
    const chunk = isFinal ? currentText : currentText.slice(0, MAX_CHUNK_SIZE);
    // console.log("isFinal", isFinal);
    // console.log("chunk", chunk);

    let chatMessages: Array<ChatCompletionRequestMessage> = [];

    // 테스트용 변수 i
    if (isFinal) {
      chatMessages.push({
        role: "system",
        content:
          "As an AI language model, I will analyze the given PDF document text and generate a database schema based on the information provided in the text. Please provide the text from the PDF document.",
      });
      chatMessages.push({ role: "user", content: chunk });
    } else {
      await sleep(1000);
      chatMessages.push({
        role: "system",
        content:
          "As an AI language model, I will remember the text provided and continue analyzing when the rest of the text is provided. If the text ends with '[CONTINUE]', please provide more text. Please respond as concisely and quickly as possible.",
      });
      chatMessages.push({ role: "user", content: chunk });
    }

    try {
      const completions = await createChatCompletionWithRetry(
        chatMessages,
        0.7
      );

      // 테스트용 변수 i
      if (isFinal) {
        result = completions?.data?.choices[0]?.message?.content as string;
        break;
      } else {
        currentText = currentText.slice(MAX_CHUNK_SIZE);
      }
    } catch (error) {
      console.error("Error while trying to create chat completion:", error);
      throw error;
    }
  }

  return result;
}

export async function extractPdfText(filePath: string): Promise<string> {
  try {
    const pdfBuffer: Buffer = fs.readFileSync(filePath);
    const data = await pdfParse(pdfBuffer);

    const totalPages: number = data.numpages;
    let extractedText = "";

    // 페이지별 텍스트 추출
    for (let i = 1; i <= totalPages; i++) {
      const pageText = await data.text.replace(/(\r\n|\n|\r)/gm, " ").trim();
      extractedText += `Page ${i}: ${pageText}\n\n`;
    }

    // const exampleText = process.env.EXAMPLE_TEXT as string;
    // return exampleText;
    return extractedText;
  } catch (error) {
    console.error("Error while extracting text from PDF:", error);
    throw error;
  }
}

export async function generateNestJsEntityFromSQL(
  sql: string
): Promise<string> {
  const chatMessages: Array<ChatCompletionRequestMessage> = [
    {
      role: "system",
      content: "Generate NestJS entity classes for the following SQL schema:",
    },
    { role: "user", content: sql },
  ];

  const completions = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: chatMessages,
    temperature: 0.7,
  });
  console.log(
    "completions?.data?.choices[0]?.message?",
    completions?.data?.choices[0]?.message
  );
  return completions?.data?.choices[0]?.message?.content as string;
}

export async function createEntityFilesInSrcFolder(
  entities: string
): Promise<void> {
  ensureSrcFolderExists();

  const entityPattern = /export class (\w+) extends BaseEntity/;

  for (const entityText of entities.split("\n\n")) {
    const match = entityText.match(entityPattern);
    if (!match) continue;

    const entityName = match[1];
    const fileName = `${entityName}.entity.ts`;
    const filePath = path.join("src", fileName);

    fs.writeFileSync(filePath, entityText);
  }
}

export async function main() {
  // 사용 예시:
  try {
    const filePath = "./plan.pdf";
    const pdfText = await extractPdfText(filePath);
    // ChatGPT를 사용하여 데이터베이스 스키마 생성
    const databaseSchema = await getDatabaseSchemaFromGPT(pdfText);
    // console.log("Generated database schema:\n", databaseSchema);
    const nestJsEntities = await generateNestJsEntityFromSQL(databaseSchema);
    console.log("Generated NestJS entity classes:\n", nestJsEntities);
    // 올바른 NestJS 엔티티 클래스를 추출합니다.
    const entityClasses = nestJsEntities.match(
      /import {[^}]+} from[^;]+;\n\n@Entity\(\)[\s\S]+?\n}/g
    );

    if (!entityClasses) {
      throw new Error(
        "Failed to extract entity classes from the generated NestJS entities."
      );
    }

    await createEntityFiles(entityClasses);
  } catch (err: any) {
    console.error("err", err);
    console.error("err.data", err?.response?.data as any);
  }
}

main();

// 사용 예시:
// const filePath = "./sample.pdf";
// extractPdfText(filePath)
//   .then((text) => {
//     console.log(text);
//   })
//   .catch((error) => {
//     console.error("Error while processing PDF:", error);
//   });
