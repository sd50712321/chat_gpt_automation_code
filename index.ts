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

async function createEntityFiles(entityClasses: string[]) {
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

async function getDatabaseSchemaFromGPT(pdfText: string): Promise<string> {
  const MAX_CHUNK_SIZE = 2000;
  const CONTINUATION_TEXT = "계속";
  let currentText = pdfText;
  let result = "";

  while (true) {
    const isFinal = currentText.length <= MAX_CHUNK_SIZE;
    const chunk = isFinal ? currentText : currentText.slice(0, MAX_CHUNK_SIZE);
    console.log("isFinal", isFinal);
    console.log("chunk", chunk);

    let chatMessages: Array<ChatCompletionRequestMessage> = [];
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

    const completions = await openai.createChatCompletion(
      {
        model: "gpt-3.5-turbo",
        messages: chatMessages,
        temperature: 0.7,
      },
      {
        timeout: 120000 * 4,
        maxBodyLength: 8192 * 40,
      }
    );

    if (isFinal) {
      result = completions?.data?.choices[0]?.message?.content as string;
      break;
    } else {
      currentText = currentText.slice(MAX_CHUNK_SIZE);
    }
  }

  return result;
}

async function extractPdfText(filePath: string): Promise<string> {
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

async function generateNestJsEntityFromSQL(sql: string): Promise<string> {
  const chatMessages: Array<ChatCompletionRequestMessage> = [
    {
      role: "system",
      content:
        "As an AI language model, I will analyze the given SQL schema and generate corresponding NestJS entity classes for each table in the schema, including relationship configurations and indexes. Please provide the SQL schema.",
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

async function createEntityFilesInSrcFolder(entities: string): Promise<void> {
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

async function main() {
  // 사용 예시:
  try {
    const filePath = "./plan.pdf";
    const pdfText = await extractPdfText(filePath);
    // ChatGPT를 사용하여 데이터베이스 스키마 생성
    const databaseSchema = await getDatabaseSchemaFromGPT(pdfText);
    // console.log("Generated database schema:\n", databaseSchema);
    const nestJsEntities = await generateNestJsEntityFromSQL(databaseSchema);
    console.log("nestJsEntities", nestJsEntities);
    await createEntityFilesInSrcFolder(nestJsEntities);
  } catch (err: any) {
    console.error("err", err);
    console.error("err.data", err?.response?.data as any);
  }
}

main();

// 사용 예시:
const filePath = "./plan.pdf";
extractPdfText(filePath)
  .then((text) => {
    console.log(text);
  })
  .catch((error) => {
    console.error("Error while processing PDF:", error);
  });
