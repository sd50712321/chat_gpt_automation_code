import fs from "fs";
import * as path from "path";
import pdfParse from "pdf-parse";
import {
  ChatCompletionRequestMessage,
  Configuration,
  CreateChatCompletionResponse,
  OpenAIApi,
} from "openai";
import dotenv from "dotenv";
import { AxiosResponse } from "axios";
import { v4 as uuidv4 } from "uuid";
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

export async function createEntityFiles(
  entityClasses: string[],
  entitiesPath: string = "./src/entities"
) {
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
  temperature: number,
  openAi: OpenAIApi = openai
): Promise<AxiosResponse<CreateChatCompletionResponse, any>> {
  const maxRetries = 5;

  for (let retries = 0; retries < maxRetries; retries++) {
    try {
      const completions = await openAi.createChatCompletion(
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

// export async function getDatabaseSchemaFromGPT(
//   pdfText: string
// ): Promise<string> {
//   const MAX_CHUNK_SIZE = 2000;
//   let currentText = pdfText;
//   let result = "";

//   while (currentText.length > 0) {
//     const isFinal = currentText.length <= MAX_CHUNK_SIZE;
//     const chunk = isFinal ? currentText : currentText.slice(0, MAX_CHUNK_SIZE);

//     let chatMessages: Array<ChatCompletionRequestMessage> = [];

//     if (isFinal) {
//       chatMessages.push({
//         role: "system",
//         content:
//           "As an AI language model, I will analyze the given PDF document text and generate a database schema based on the information provided in the text. Please provide the text from the PDF document.",
//       });
//       chatMessages.push({ role: "user", content: chunk });
//     } else {
//       await sleep(1000);
//       chatMessages.push({
//         role: "system",
//         content:
//           "As an AI language model, I will remember the text provided and continue analyzing when the rest of the text is provided. If the text ends with '[CONTINUE]', please provide more text. Please respond as concisely and quickly as possible.",
//       });
//       chatMessages.push({ role: "user", content: chunk });
//     }

//     try {
//       const completions = await createChatCompletionWithRetry(
//         chatMessages,
//         0.7
//       );

//       if (isFinal) {
//         result = completions?.data?.choices[0]?.message?.content as string;
//         break;
//       } else {
//         currentText = currentText.slice(MAX_CHUNK_SIZE);
//       }
//     } catch (error) {
//       console.error("Error while trying to create chat completion:", error);
//       throw error;
//     }
//   }

//   return result;
// }
export async function getDatabaseSchemaFromGPT(
  pdfText: string
): Promise<string> {
  const MAX_CHUNK_SIZE = 4000;
  let currentText = pdfText;
  console.log("pdfText", pdfText);
  const totalPages = Math.ceil(currentText.length / MAX_CHUNK_SIZE);
  console.log("totalPages", totalPages);
  console.log("currentText", currentText);

  const processPage = async (chunk: string): Promise<string> => {
    let chatMessages: Array<ChatCompletionRequestMessage> = [];
    chatMessages.push({
      role: "system",
      content: `Based on the current text, refine and add to ${Math.ceil(
        MAX_CHUNK_SIZE / totalPages
      )} content or compress and summarize. in korean`,
    });
    chatMessages.push({ role: "user", content: chunk });

    try {
      const completions = await createChatCompletionWithRetry(
        chatMessages,
        0.7
      );
      return completions?.data?.choices[0]?.message?.content as string;
    } catch (error) {
      console.error("Error while trying to create chat completion:", error);
      console.error(
        "Error while trying to create chat completion:",
        error.response.data
      );
      throw error;
    }
  };

  const chunks = Array.from({ length: totalPages }, (_, i) => {
    const chunkStart = i * MAX_CHUNK_SIZE;
    const chunkEnd = (i + 1) * MAX_CHUNK_SIZE;
    return currentText.slice(chunkStart, chunkEnd);
  });

  const summaries = await Promise.all(
    chunks.map((chunk) => processPage(chunk))
  );
  const allSummaries = summaries.join(" ");
  console.log("allSummaries", allSummaries);

  let chatMessages: Array<ChatCompletionRequestMessage> = [];
  chatMessages.push({
    role: "system",
    content: `Given the description of an online camping reservation platform which allows users to search and reserve camping spots based on various criteria, generate the SQL schema creation statements in the form of CREATE TABLE statements.
    `,
  });
  chatMessages.push({ role: "user", content: allSummaries });

  try {
    const completions = await createChatCompletionWithRetry(chatMessages, 0.7);
    console.log("completions?.data?.choices[0]", completions?.data?.choices[0]);
    return completions?.data?.choices[0]?.message?.content as string;
  } catch (error) {
    console.error("Error while trying to create chat completion:", error);
    console.error(
      "Error while trying to create chat completion:",
      error.response.data
    );
    throw error;
  }
}

export async function extractPdfText(filePath: string): Promise<string> {
  try {
    const pdfBuffer: Buffer = fs.readFileSync(filePath);
    const data = await pdfParse(pdfBuffer);

    const totalPages: number = data.numpages;
    let extractedText = "";

    // 페이지별 텍스트 추출
    for (let i = 1; i <= totalPages; i++) {
      const pageText = data.text.replace(/(\r\n|\n|\r)/gm, " ").trim();
      extractedText += `Page ${i}: ${pageText}\n\n`;
    }

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

function copyRecursive(src, dest) {
  if (fs.statSync(src).isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest);
    }
    const files = fs.readdirSync(src);
    for (const file of files) {
      const srcPath = path.join(src, file);
      const destPath = path.join(dest, file);
      copyRecursive(srcPath, destPath);
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

export async function createCRUDFilesFromSQL(
  sqlFilePath: string,
  outputPath: string
) {
  // Read SQL file
  const sqlContent = fs.readFileSync(sqlFilePath, "utf-8");
  console.log("sqlContent", sqlContent);

  // Read the index.js template file
  const indexTemplatePath = path.join(
    __dirname,
    "api_src",
    "server",
    "models",
    "index.js"
  );
  const indexTemplateContent = fs.readFileSync(indexTemplatePath, "utf-8");

  // Create a new folder with the SQL file name without the .sql extension
  // const folderName = path.basename(sqlFilePath, ".sql");
  const newFolderPath = path.join("projects", outputPath);
  if (!fs.existsSync(newFolderPath)) {
    fs.mkdirSync(newFolderPath);
  }

  // Copy api_src folder to the new folder
  const apiSrcPath = path.join(__dirname, "api_src");
  copyRecursive(apiSrcPath, newFolderPath);
  // fs.readdirSync(apiSrcPath).forEach((file) => {
  //   fs.copyFileSync(
  //     path.join(apiSrcPath, file),
  //     path.join(newFolderPath, file)
  //   );
  // });

  // Extract CREATE TABLE statements from SQL content
  const createTableRegex =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\S+?)`?\s*\((?:.|\s)+?\)(?:.|\s)*?(?=CREATE\s+TABLE|$)/gi;

  const tableStatements = sqlContent.match(createTableRegex);
  console.log("tableStatements", tableStatements);
  if (!tableStatements || !Array.isArray(tableStatements)) {
    console.error(
      "No CREATE TABLE statements found in the provided SQL file or it is not iterable."
    );
    return;
  }
  console.log("tableStatements", tableStatements);

  // Generate CRUD files for each table
  const processingPromises = tableStatements.map((statement) =>
    processTableStatement(statement, indexTemplateContent, newFolderPath)
  );

  await Promise.all(processingPromises);

  console.log(`CRUD files generated in ${newFolderPath}`);
}

async function processTableStatement(
  statement,
  indexTemplateContent,
  newFolderPath
) {
  const tableNameRegex = /CREATE TABLE `?(\w+)`?/i;
  const tableNameMatch = statement.match(tableNameRegex);
  if (tableNameMatch) {
    const tableName = tableNameMatch[1];

    // Generate CRUD content using GPT-4
    const modelContent = await generateCRUDForTableWithGPT4(
      tableName,
      statement,
      indexTemplateContent
    );

    // Extract the code block from the GPT-4 output
    const codeBlockRegex = /```([\s\S]*?)```/g;
    const codeBlockMatch = codeBlockRegex.exec(modelContent);
    if (codeBlockMatch) {
      const codeBlock = codeBlockMatch[1];

      const modelFilePath = path.join(
        newFolderPath,
        "server",
        "models",
        `${tableName}.js`
      );
      fs.writeFileSync(modelFilePath, codeBlock);
    } else {
      console.error(
        `Could not extract the code block from GPT-4 output for table ${tableName}`
      );
    }
  }
}

async function generateCRUDForTableWithGPT4(
  tableName: string,
  tableSchema: string,
  indexTemplate: string
) {
  // Prepare the chatMessages array
  const chatMessages: ChatCompletionRequestMessage[] = [
    {
      role: "system",
      content:
        "As an AI language model, I will generate CRUD logic for a table based on the provided table schema and index template. Please provide the table name, table schema, and index template. Make sure to generate complete and detailed CRUD logic, considering the index template for optimized query statements and any necessary dynamic queries.",
    },
    {
      role: "user",
      content: JSON.stringify({
        tableName,
        tableSchema,
        indexTemplate,
      }),
    },
  ];

  // Send the chatMessages to GPT-4 and get the response
  const completions = await createChatCompletionWithRetry(chatMessages, 0.7);
  const generatedCRUD = completions?.data?.choices[0]?.message
    ?.content as string;

  // Return the generated CRUD logic
  return generatedCRUD;
}

async function main() {
  // 사용 예시:
  try {
    const filePath = "./sample4.pdf";
    const pdfText = await extractPdfText(filePath);
    // ChatGPT를 사용하여 데이터베이스 스키마 생성
    const databaseSchema = await getDatabaseSchemaFromGPT(pdfText);
    // 추가된 부분: 데이터베이스 스키마를 SQL 파일로 저장
    const dbSchemaPath = "./db_schema";
    if (!fs.existsSync(dbSchemaPath)) {
      fs.mkdirSync(dbSchemaPath);
    }
    const sqlFileName = `${uuidv4()}.sql`;
    const sqlFilePath = path.join(dbSchemaPath, sqlFileName);
    fs.writeFileSync(sqlFilePath, databaseSchema);
    console.log(`Saved database schema to ${sqlFilePath}`);
    // const sqlFilePath = "./db_schema/5dd6fef1-e66d-4122-9878-2cd6f550da9f.sql";
    // const name = "5dd6fef1-e66d-4122-9878-2cd6f550da9f";
    await createCRUDFilesFromSQL(sqlFilePath, sqlFileName.split(".")[0]);
    // await createCRUDFilesFromSQL(sqlFilePath, name);
    // console.log("Generated database schema:\n", databaseSchema);
    // const nestJsEntities = await generateNestJsEntityFromSQL(databaseSchema);
    // console.log("Generated NestJS entity classes:\n", nestJsEntities);
    // 올바른 NestJS 엔티티 클래스를 추출합니다.
    // const entityClasses = nestJsEntities.match(
    //   /import {[^}]+} from[^;]+;\n\n@Entity\(\)[\s\S]+?\n}/g
    // );

    // if (!entityClasses) {
    //   throw new Error(
    //     "Failed to extract entity classes from the generated NestJS entities."
    //   );
    // }

    // await createEntityFiles(entityClasses);
  } catch (err: any) {
    console.error("err", err);
    console.error("err.data", err?.response?.data as any);
  }
}

if (require.main === module) {
  main();
}
