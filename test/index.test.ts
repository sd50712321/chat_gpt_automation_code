import {
  extractPdfText,
  getDatabaseSchemaFromGPT,
  generateNestJsEntityFromSQL,
  createEntityFiles,
  createChatCompletionWithRetry,
} from "../index";
import fs, { readFileSync } from "fs";
import {
  ChatCompletionRequestMessage,
  Configuration,
  CreateChatCompletionResponse,
  OpenAIApi,
} from "openai";
import { Result } from "pdf-parse";
import * as pdfParse from "pdf-parse";
class MockOpenAIApi extends OpenAIApi {
  createChatCompletion = jest.fn();
}
jest.mock("openai", () => ({
  OpenAIApi: jest.fn().mockImplementation(() => ({
    createChatCompletion: jest.fn().mockImplementation(() => {
      return Promise.resolve({
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
        data: {
          id: "1",
          object: "test",
          created: 1,
          model: "gpt-3.5-turbo",
          choices: [
            {
              message: {
                role: "system",
                content: "test",
              },
            },
          ],
        },
      });
    }),
  })),
  Configuration: jest.fn().mockImplementation(() => ({})),
}));
jest.mock("pdf-parse");
jest.mock("fs");

describe("main 로직 테스트", () => {
  const mockOpenAIApi = new MockOpenAIApi();
  beforeEach(() => {});

  afterEach(() => {
    jest.clearAllMocks();
  });
  describe("Entity 객체 생성 테스트", () => {
    it("pdf파일로부터 text 추출해야한다", async () => {
      let readFileSyncMock = jest.spyOn(fs, "readFileSync");
      // pdfParse 함수 모킹
      const pdfParseMock: Result = {
        numpages: 1,
        numrender: 0,
        info: {},
        metadata: null,
        text: "Mocked text for testing purposes.\n\nPage 2: Mocked text for testing purposes.\n\n",
        version: "default",
      };
      jest.spyOn(pdfParse, "default").mockResolvedValue(pdfParseMock);
      const extractedText = await extractPdfText("test.pdf");
      const expectedText =
        "Page 1: Mocked text for testing purposes.  Page 2: Mocked text for testing purposes.\n\n";
      expect(extractedText).toEqual(expectedText);

      // 모킹된 함수가 호출되었는지 확인
      expect(pdfParse.default).toHaveBeenCalledTimes(1);
      // pdf parse 때문에 2번 호출
      expect(readFileSyncMock).toHaveBeenCalledTimes(2);
    });

    it("데이터베이스 스키마 작성에 대한 리턴값이 나와야 한다", async () => {
      const sampleText = "Sample text from PDF file.";

      const databaseSchema = await getDatabaseSchemaFromGPT(sampleText);

      // 결과에 대한 기대값 설정
      expect(databaseSchema).toBeTruthy(); // 결과가 참인지 확인
      expect(databaseSchema.length).toBeGreaterThan(0); // 결과의 길이가 0보다 큰지 확인
      expect(databaseSchema).toEqual("test"); // 결과가 "test"와 동일한지 확인
    });

    it("sql 스키마로 nestjs Entity파일 생성이 이루어져야한다", async () => {
      const sampleSQLSchema =
        "CREATE TABLE example (id INT PRIMARY KEY, name VARCHAR(255));";
      const nestJsEntityClasses = await generateNestJsEntityFromSQL(
        sampleSQLSchema
      );
      expect(nestJsEntityClasses).toBeTruthy();
      expect(nestJsEntityClasses.length).toBeGreaterThan(0);
    });
    // });

    it("특정 directory에 entity 파일이 생성되어야 한다", async () => {
      const entitiesPath = "test/entities";
      const filePath = `${entitiesPath}/SampleEntity.ts`;
      const entityClasses = [
        `import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
  
  @Entity()
  export class SampleEntity extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;
  
    @Column()
    name: string;
  }`,
      ];

      const existsSyncMock = jest.spyOn(fs, "existsSync");
      const mkdirSyncMock = jest.spyOn(fs, "mkdirSync");
      const writeFileSyncMock = jest.spyOn(fs, "writeFileSync");

      existsSyncMock.mockReturnValueOnce(false).mockReturnValueOnce(true);
      mkdirSyncMock.mockReturnValue(undefined);
      writeFileSyncMock.mockReturnValue(undefined);

      await createEntityFiles(entityClasses, entitiesPath);

      expect(existsSyncMock).toHaveBeenCalledTimes(1);
      expect(existsSyncMock).toHaveBeenNthCalledWith(1, entitiesPath);
      // expect(existsSyncMock).toHaveBeenNthCalledWith(2, filePath);
      expect(mkdirSyncMock).toHaveBeenCalledTimes(1);
      expect(mkdirSyncMock).toHaveBeenCalledWith(entitiesPath, {
        recursive: true,
      });
      expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
      expect(writeFileSyncMock).toHaveBeenCalledWith(
        filePath,
        entityClasses[0]
      );

      existsSyncMock.mockRestore();
      mkdirSyncMock.mockRestore();
      writeFileSyncMock.mockRestore();
    });

    it("chat gpt response가 정상적으로 반환해야한다", async () => {
      const messages: ChatCompletionRequestMessage[] = [
        {
          role: "system",
          content: "Hello, AI. Please respond to this message.",
        },
        {
          role: "user",
          content: "Hello!",
        },
      ];

      const completions = await createChatCompletionWithRetry(messages, 0.7);
      expect(completions).toBeTruthy();
      expect(completions?.data).toBeTruthy();
      expect(completions?.data.choices).toBeTruthy();
      expect(completions?.data.choices.length).toBeGreaterThan(0);
      expect(completions?.data?.choices[0]?.message?.content).toBeTruthy();
    });

    it("3번 타임아웃 후 정상 성공", async () => {
      const messages: ChatCompletionRequestMessage[] = [
        {
          role: "system",
          content: "Hello, AI. Please respond to this message.",
        },
        {
          role: "user",
          content: "Hello!",
        },
      ];

      // Fail 3 times
      mockOpenAIApi.createChatCompletion
        .mockRejectedValueOnce(new Error("Request timeout"))
        .mockRejectedValueOnce(new Error("Request timeout"))
        .mockRejectedValueOnce(new Error("Request timeout"))
        // Then succeed
        .mockResolvedValueOnce({
          data: {
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "Hello, I'm here to help!",
                },
              },
            ],
          },
        });

      // Pass the mocked OpenAIApi instance to the function
      const completions = await createChatCompletionWithRetry(
        messages,
        0.7,
        mockOpenAIApi
      );
      expect(completions).toBeTruthy();
      expect(completions?.data).toBeTruthy();
      expect(completions?.data.choices).toBeTruthy();
      expect(completions?.data.choices.length).toBeGreaterThan(0);
      expect(completions?.data.choices[0].message.content).toBeTruthy();
    });
  });
});
