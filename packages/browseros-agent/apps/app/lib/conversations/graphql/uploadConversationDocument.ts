import { graphql } from '@/generated/graphql/gql'

export const GetProfileIdByUserIdDocument = graphql(`
  query GetProfileIdByUserId($userId: String!) {
    profileByUserId(userId: $userId) {
      rowId
    }
  }
`)
